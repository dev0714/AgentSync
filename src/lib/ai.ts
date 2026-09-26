import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { serviceClient } from './supabase';
import { resolveSecret } from './secrets';

/**
 * One structured call to Claude on behalf of an agent.
 *
 * Every agent answers in JSON against a schema (structured outputs), so a plan,
 * a set of file edits or a review verdict is parsed, never scraped out of
 * prose. Usage and cost are recorded against the task on every call, and the
 * project's monthly budget is checked before one is made.
 */

export const DEFAULT_MODEL = 'claude-opus-5';

/** USD per million tokens, [input, output]. Unknown models are costed as Opus. */
const PRICES: Record<string, [number, number]> = {
  'claude-fable-5-1': [10, 50],
  'claude-fable-5': [10, 50],
  'claude-opus-5-5': [4, 20],
  'claude-opus-5': [5, 25],
  'claude-opus-4-8': [5, 25],
  'claude-opus-4-7': [5, 25],
  'claude-opus-4-6': [5, 25],
  'claude-sonnet-5': [2, 10],
  'claude-sonnet-4-6': [3, 15],
  'claude-haiku-4-5': [1, 5],
};

export function costOf(model: string, input: number, output: number): number {
  const [i, o] = PRICES[model] ?? PRICES[DEFAULT_MODEL];
  return (input * i + output * o) / 1_000_000;
}

export class BudgetExceeded extends Error {
  readonly code = 'BUDGET_EXCEEDED';
}

export class ModelRefused extends Error {
  readonly code = 'MODEL_REFUSED';
}

export type AiContext = {
  taskId: string;
  /** The tenant's anthropic credential row, if any (key_reference, model). */
  credential: { key_reference?: string | null; model?: string | null } | null;
  monthlyBudget: number | null;
  monthSpend: number;
};

export type AgentDefinition = {
  key: string;
  display_name: string;
  system_prompt: string | null;
  model: string | null;
  /** Thinking effort for this agent at the task's tier; null where the model takes none. */
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | null;
  /** The tier the task runs at: low, medium or high. */
  tier: string | null;
  limits: Record<string, unknown> | null;
};

/** Haiku 4.5 predates adaptive thinking and effort; sending either is a 400. */
const takesEffort = (model: string) => !model.startsWith('claude-haiku-4-5');

/** Models that accept Anthropic's server-side refusal fallback. */
const takesFallback = (model: string) =>
  model.startsWith('claude-opus-5') || model.startsWith('claude-fable-5-1');

/** Loads the agent a stage runs as: project override, then tenant, then platform. */
export async function loadAgent(taskId: string, key: string): Promise<AgentDefinition> {
  const { data, error } = await serviceClient().rpc('agentsync_agent_for', {
    p_task_id: taskId,
    p_key: key,
  });
  if (error) throw error;
  if (!data) throw new Error(`no agent definition for "${key}"`);
  return data as AgentDefinition;
}

export async function clientFor(ctx: AiContext): Promise<Anthropic> {
  const ref = ctx.credential?.key_reference;
  const apiKey = ref ? await resolveSecret(ref) : process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'no Anthropic key: set ANTHROPIC_API_KEY or add an Anthropic credential under Connections',
    );
  }
  return new Anthropic({ apiKey });
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, k: string) => vars[k] ?? m);
}

/**
 * Runs `agent` on `prompt` and returns the parsed JSON matching `schema`.
 *
 * Streams (outputs such as full file contents can be long), with adaptive
 * thinking. Claude Opus 5 requests opt into server-side refusal fallback.
 */
export async function runAgent<T>(params: {
  ctx: AiContext;
  agent: AgentDefinition;
  projectName: string;
  prompt: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
}): Promise<T> {
  const { ctx, agent } = params;

  if (ctx.monthlyBudget !== null && ctx.monthlyBudget > 0 && ctx.monthSpend >= ctx.monthlyBudget) {
    throw new BudgetExceeded(
      `project has spent $${ctx.monthSpend.toFixed(2)} of its $${ctx.monthlyBudget} monthly AI budget`,
    );
  }

  const model = agent.model || ctx.credential?.model || DEFAULT_MODEL;
  const client = await clientFor(ctx);
  const system = fill(agent.system_prompt ?? `You are the ${agent.display_name}.`, {
    'project.name': params.projectName,
  });

  const effort = takesEffort(model) ? agent.effort : null;
  const request = {
    model,
    max_tokens: params.maxTokens ?? 64000,
    system,
    ...(takesEffort(model) ? { thinking: { type: 'adaptive' as const } } : {}),
    output_config: {
      format: { type: 'json_schema' as const, schema: params.schema },
      ...(effort ? { effort } : {}),
    },
    messages: [{ role: 'user' as const, content: params.prompt }],
  };

  const started = Date.now();
  const message = takesFallback(model)
    ? await client.beta.messages
        .stream({
          ...request,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        })
        .finalMessage()
    : await client.messages.stream(request).finalMessage();
  const seconds = (Date.now() - started) / 1000;

  const input = message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0);
  const output = message.usage.output_tokens;
  const cost = costOf(message.model, input, output);
  ctx.monthSpend += cost;

  const { error } = await serviceClient().rpc('agentsync_record_ai_usage', {
    p_task_id: ctx.taskId,
    p_agent_key: agent.key,
    p_model: message.model,
    p_input_tokens: input,
    p_output_tokens: output,
    p_cost: cost,
    p_duration_seconds: seconds,
  });
  if (error) console.error('could not record AI usage', error);

  if (message.stop_reason === 'refusal') {
    throw new ModelRefused(`${agent.display_name} declined the request`);
  }
  if (message.stop_reason === 'max_tokens') {
    throw new Error(`${agent.display_name} ran out of output tokens before finishing`);
  }

  let text = '';
  for (const block of message.content as { type: string; text?: string }[]) {
    if (block.type === 'text' && block.text) text += block.text;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${agent.display_name} returned output that is not valid JSON`);
  }
}
