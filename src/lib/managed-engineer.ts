import 'server-only';
import { createHash } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import { clientFor, type AgentDefinition, type AiContext } from './ai';
import { serviceClient } from './supabase';

/**
 * The Engineer as a Claude Managed Agent.
 *
 * Anthropic runs the agent loop and a sandbox with the repository cloned in;
 * the agent edits, runs the project's own install/lint/typecheck/test/build,
 * fixes what fails, commits and pushes the task branch. AgentSync keeps the
 * gates: it checks what was pushed against the approved plan before any pull
 * request is opened, and a person still approves the merge.
 *
 * One agent and one environment exist per Anthropic credential, created on
 * first use and stored; a changed Engineer prompt updates the agent (a new
 * version), it never creates another. Each task attempt is one session, run at
 * the task's tier through `agent_with_overrides` (model and effort).
 */

const SANDBOX_RULES = `
You are working inside a sandbox with the repository cloned at /workspace/repo.

How you work:
- Implement exactly the approved plan. Change only the files it lists. Never touch
  .github/workflows, .env files, private keys, or anything outside the plan.
- Work on the branch you are given. Create it from the default branch if it does not
  exist yet; if it exists, check it out and build on it.
- Install dependencies and run the project's own checks (lint, typecheck, tests, build —
  whatever the repository defines). Fix what you broke and run them again. Do not
  disable, skip or delete tests or checks to make them pass.
- Commit with a clear message and push the branch to origin. Never push to the default
  branch, never force-push over someone else's work, and never merge anything.
- If the plan cannot be carried out safely, stop and explain why instead of improvising.

When you are finished, end your final message with a fenced \`\`\`json block containing
exactly this object and nothing after it:
{"status": "pushed" | "blocked", "branch": "<branch>", "commit_sha": "<sha or empty>",
 "checks": [{"name": "<e.g. test>", "command": "<command run>", "passed": true|false, "output_tail": "<last lines>"}],
 "summary": "<what you changed and why, two or three sentences>", "notes": "<anything a reviewer should know>"}
`.trim();

type Setup = { agent_id: string; agent_version: number; environment_id: string; prompt_hash: string };

function credentialKey(ctx: AiContext): string {
  return ctx.credential?.key_reference || 'env:ANTHROPIC_API_KEY';
}

/** The stored agent and environment for this credential, created or updated as needed. */
/**
 * The agent's saved prompt is the same for every project — the project name
 * goes in each session's instructions instead — so switching projects never
 * publishes a new agent version.
 */
function agentSystem(engineer: Pick<AgentDefinition, 'system_prompt'>): string {
  const base = (engineer.system_prompt ?? 'You are the Engineer.').replace(/\{\{\s*project\.name\s*\}\}/g, 'this project');
  return `${base}\n\n${SANDBOX_RULES}`;
}

async function ensureSetup(
  client: Anthropic,
  ctx: AiContext,
  engineer: Pick<AgentDefinition, 'system_prompt'>,
): Promise<{ setup: Setup; system: string; action: 'unchanged' | 'created' | 'updated' }> {
  const system = agentSystem(engineer);
  const hash = createHash('sha256').update(system).digest('hex');
  const key = credentialKey(ctx);

  const { data } = await serviceClient().rpc('agentsync_managed_setup_get', { p_credential_key: key });
  const stored = data as Setup | null;

  if (stored && stored.prompt_hash === hash) return { setup: stored, system, action: 'unchanged' };

  let agentId = stored?.agent_id;
  let version = stored?.agent_version;
  let environmentId = stored?.environment_id;

  if (!environmentId) {
    const env = await client.beta.environments.create({
      name: 'agentsync-engineer',
      config: { type: 'cloud', networking: { type: 'unrestricted' } },
    });
    environmentId = env.id;
  }

  const created = !agentId;
  if (!agentId) {
    const agent = await client.beta.agents.create({
      name: 'AgentSync Engineer',
      description: 'Implements an approved plan in a sandbox, runs the checks, pushes the branch.',
      model: 'claude-opus-5-5',
      system,
      tools: [{ type: 'agent_toolset_20260401', default_config: { enabled: true } }],
    });
    agentId = agent.id;
    version = agent.version;
  } else {
    // The Engineer's prompt was edited: a new version of the same agent.
    const agent = await client.beta.agents.update(agentId, { system, version });
    version = agent.version;
  }

  const setup: Setup = { agent_id: agentId, agent_version: version ?? 1, environment_id: environmentId, prompt_hash: hash };
  await serviceClient().rpc('agentsync_managed_setup_put', {
    p_credential_key: key,
    p_agent_id: setup.agent_id,
    p_agent_version: setup.agent_version,
    p_environment_id: setup.environment_id,
    p_prompt_hash: setup.prompt_hash,
  });
  return { setup, system, action: created ? 'created' : 'updated' };
}

/**
 * Creates the Engineer in Claude, or publishes a new version if its prompt
 * changed — the "Create in Claude" / "Sync to Claude" button. Idempotent: when
 * nothing changed, nothing is sent.
 */
export async function syncEngineerAgent(credentialKeyRef: string, engineer: Pick<AgentDefinition, 'system_prompt'>) {
  const ctx: AiContext = {
    taskId: '',
    credential: credentialKeyRef.startsWith('env:ANTHROPIC_API_KEY') ? null : { key_reference: credentialKeyRef },
    monthlyBudget: null,
    monthSpend: 0,
  };
  const client = await clientFor(ctx);
  return ensureSetup(client, ctx, engineer);
}

/** Dollar cap per session by tier, in cents. A session at its cap pauses. */
const BUDGET_CENTS: Record<string, number> = { low: 300, medium: 800, high: 2000 };

export async function startEngineerSession(params: {
  ctx: AiContext;
  engineer: AgentDefinition;
  projectName: string;
  repoUrl: string;
  checkoutBranch: string;
  token: string;
  prompt: string;
  title: string;
}): Promise<{ sessionId: string; resourceId: string | null; model: string }> {
  const client = await clientFor(params.ctx);
  const { setup } = await ensureSetup(client, params.ctx, params.engineer);
  const model = params.engineer.model || 'claude-opus-5-5';
  const tier = params.engineer.tier ?? 'medium';

  const session = await client.beta.sessions.create({
    agent: {
      type: 'agent_with_overrides',
      id: setup.agent_id,
      version: setup.agent_version,
      model: params.engineer.effort && !model.startsWith('claude-haiku-4-5')
        ? { id: model, effort: params.engineer.effort }
        : model,
    },
    environment_id: setup.environment_id,
    title: params.title.slice(0, 200),
    resources: [
      {
        type: 'github_repository',
        url: params.repoUrl,
        authorization_token: params.token,
        mount_path: '/workspace/repo',
        checkout: { type: 'branch', name: params.checkoutBranch },
      },
    ],
    budget: {
      type: 'limit',
      max_list_cost: { amount: String(BUDGET_CENTS[tier] ?? 800), currency: 'USD' },
    },
    initial_events: [{ type: 'user.message', content: [{ type: 'text', text: `Project: ${params.projectName}\n\n${params.prompt}` }] }],
  });

  const repo = (session.resources ?? []).find((r) => r.type === 'github_repository') as { id?: string } | undefined;
  return { sessionId: session.id, resourceId: repo?.id ?? null, model };
}

export type SessionState =
  | { state: 'running' }
  | { state: 'done'; report: EngineerReport | null; text: string; usage: SessionUsage }
  | { state: 'stopped'; reason: string; usage: SessionUsage };

export type EngineerReport = {
  status: 'pushed' | 'blocked';
  branch: string;
  commit_sha: string;
  checks: { name: string; command: string; passed: boolean; output_tail: string }[];
  summary: string;
  notes: string;
};

export type SessionUsage = { input: number; output: number; costCents: number };

function usageOf(session: { usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; list_cost?: { amount: string } | null } }): SessionUsage {
  const u = session.usage ?? {};
  return {
    input: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
    output: u.output_tokens ?? 0,
    costCents: Number(u.list_cost?.amount ?? 0),
  };
}

/** Where a session is, and — once it has finished its turn — what it reported. */
export async function engineerSessionState(ctx: AiContext, sessionId: string): Promise<SessionState> {
  const client = await clientFor(ctx);
  const session = await client.beta.sessions.retrieve(sessionId);
  const usage = usageOf(session as never);

  if (session.status === 'running' || session.status === 'rescheduling') return { state: 'running' };
  if (session.status === 'terminated') return { state: 'stopped', reason: 'the sandbox session ended unexpectedly', usage };

  // idle: why did it stop? Read the latest events and pick out what we need.
  const recent = await client.beta.sessions.events.list(sessionId, { order: 'desc', limit: 100 } as never);
  const events = (recent.data ?? []) as { type: string; stop_reason?: { type?: string }; content?: { type: string; text?: string }[] }[];
  const idle = events.find((e) => e.type === 'session.status_idle' || e.type === 'status_idle');
  const reason = idle?.stop_reason?.type ?? 'end_turn';
  if (reason === 'budget_reached') return { state: 'stopped', reason: 'the session reached its spending cap for this tier', usage };
  if (reason === 'requires_action') return { state: 'stopped', reason: 'the session is waiting for a tool confirmation it should not need', usage };

  let text = '';
  for (const event of events) {
    if (event.type !== 'agent.message') continue;
    const t = (event.content ?? []).map((b) => (b.type === 'text' ? b.text ?? '' : '')).join('');
    if (t.includes('```json')) {
      text = t;
      break;
    }
    if (!text && t.trim()) text = t;
  }
  const match = text.match(/```json\s*([\s\S]*?)```(?![\s\S]*```json)/);
  let report: EngineerReport | null = null;
  if (match) {
    try {
      report = JSON.parse(match[1]) as EngineerReport;
    } catch {
      report = null;
    }
  }
  return { state: 'done', report, text, usage };
}

/** Installation tokens last an hour; hand a fresh one to a long-running session. */
export async function rotateSessionToken(ctx: AiContext, sessionId: string, resourceId: string, token: string) {
  const client = await clientFor(ctx);
  await client.beta.sessions.resources.update(resourceId, { session_id: sessionId, authorization_token: token });
}

export async function stopEngineerSession(ctx: AiContext, sessionId: string) {
  const client = await clientFor(ctx);
  await client.beta.sessions.events
    .send(sessionId, { events: [{ type: 'user.interrupt' }] } as never)
    .catch(() => undefined);
}
