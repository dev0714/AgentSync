import 'server-only';
import type { AgentDefinition, AiContext } from './ai';
import { openaiClientFor, openaiCostOf } from './ai';
import type { EngineerReport, SessionState } from './managed-engineer';

/**
 * The Engineer in OpenAI's hosted shell container — the OpenAI counterpart of
 * the Claude Managed Agent.
 *
 * One background Responses API run per attempt: the model gets a `shell` tool
 * whose container can reach only GitHub and the package registries, with the
 * GitHub installation token supplied as a secret scoped to github.com. It
 * clones, implements the approved plan, runs the project's checks, fixes what
 * fails and pushes the branch, then answers with the same report the Claude
 * sandbox gives — so everything after it (the check against the plan, the pull
 * request, CI and review) is shared.
 */

const ALLOWED_DOMAINS = [
  'github.com',
  'api.github.com',
  'codeload.github.com',
  'objects.githubusercontent.com',
  'registry.npmjs.org',
  'registry.yarnpkg.com',
  'pypi.org',
  'files.pythonhosted.org',
  'nodejs.org',
];

const RULES = `
You are working in a Linux container with a shell tool. Network access is limited
to GitHub and the package registries.

How you work:
- Clone the repository with the GITHUB_TOKEN secret provided for github.com:
  git clone https://x-access-token:$GITHUB_TOKEN@github.com/{{repo}}.git /workspace/repo
  Configure git user.name "AgentSync Engineer" and user.email "agentsync@users.noreply.github.com".
- Implement exactly the approved plan. Change only the files it lists. Never touch
  .github/workflows, .env files, private keys, or anything outside the plan.
- Work on the branch you are given: create it from the default branch if it does not exist,
  otherwise check it out and build on it.
- Install dependencies and run the project's own checks (lint, typecheck, tests, build —
  whatever the repository defines). Fix what you broke and run them again. Never disable,
  skip or delete tests or checks to make them pass.
- Commit with a clear message and push the branch to origin. Never push to the default
  branch, never force-push, never merge.
- If the plan cannot be carried out safely, stop and say why in the report.

Your final answer is the report object required by the response format.
`.trim();

const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['pushed', 'blocked'] },
    branch: { type: 'string' },
    commit_sha: { type: 'string' },
    checks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          command: { type: 'string' },
          passed: { type: 'boolean' },
          output_tail: { type: 'string' },
        },
        required: ['name', 'command', 'passed', 'output_tail'],
        additionalProperties: false,
      },
    },
    summary: { type: 'string' },
    notes: { type: 'string' },
  },
  required: ['status', 'branch', 'commit_sha', 'checks', 'summary', 'notes'],
  additionalProperties: false,
};

/** The tier's model when it is a GPT model; otherwise the OpenAI default for the tier. */
function engineerModel(ctx: AiContext, engineer: AgentDefinition): string {
  if (engineer.model && /^(gpt-|o\d)/.test(engineer.model)) return engineer.model;
  return ctx.openai?.model || (engineer.tier === 'low' ? 'gpt-5.4-mini' : 'gpt-5.5');
}

export async function startOpenAIEngineer(params: {
  ctx: AiContext;
  engineer: AgentDefinition;
  projectName: string;
  repoFullName: string;
  token: string;
  prompt: string;
  /** Request attachments already uploaded to OpenAI, placed in the container. */
  fileIds?: string[];
}): Promise<{ sessionId: string; model: string }> {
  const client = await openaiClientFor(params.ctx);
  const model = engineerModel(params.ctx, params.engineer);
  const base = (params.engineer.system_prompt ?? 'You are the Engineer.').replace(/\{\{\s*project\.name\s*\}\}/g, params.projectName);
  const effort = params.engineer.effort;

  const response = await client.responses.create({
    model,
    background: true,
    store: true,
    instructions: `${base}\n\n${RULES.replace('{{repo}}', params.repoFullName)}`,
    input: `Project: ${params.projectName}\n\n${params.prompt}`,
    ...(effort ? { reasoning: { effort } } : {}),
    tools: [
      {
        type: 'shell',
        environment: {
          type: 'container_auto',
          memory_limit: '4g',
          ...(params.fileIds?.length ? { file_ids: params.fileIds } : {}),
          network_policy: {
            type: 'allowlist',
            allowed_domains: ALLOWED_DOMAINS,
            domain_secrets: [{ domain: 'github.com', name: 'GITHUB_TOKEN', value: params.token }],
          },
        },
      },
    ],
    text: { format: { type: 'json_schema', name: 'engineer_report', schema: REPORT_SCHEMA, strict: true } },
  });
  return { sessionId: response.id, model };
}

export async function openaiEngineerState(ctx: AiContext, responseId: string, model: string): Promise<SessionState> {
  const client = await openaiClientFor(ctx);
  const response = await client.responses.retrieve(responseId);
  const input = response.usage?.input_tokens ?? 0;
  const output = response.usage?.output_tokens ?? 0;
  const usage = { input, output, costCents: Math.round(openaiCostOf(model, input, output) * 100) };

  if (response.status === 'queued' || response.status === 'in_progress') return { state: 'running', usage: { input: 0, output: 0, costCents: 0 } };
  if (response.status === 'failed') return { state: 'stopped', reason: response.error?.message ?? 'the OpenAI run failed', usage };
  if (response.status === 'cancelled') return { state: 'stopped', reason: 'the OpenAI run was cancelled', usage };
  if (response.status === 'incomplete') {
    return { state: 'stopped', reason: `the OpenAI run stopped early (${response.incomplete_details?.reason ?? 'incomplete'})`, usage };
  }

  const text = response.output_text ?? '';
  let report: EngineerReport | null = null;
  try {
    report = JSON.parse(text) as EngineerReport;
  } catch {
    report = null;
  }
  return { state: 'done', report, text, usage };
}

export async function stopOpenAIEngineer(ctx: AiContext, responseId: string) {
  const client = await openaiClientFor(ctx);
  await client.responses.cancel(responseId).catch(() => undefined);
}
