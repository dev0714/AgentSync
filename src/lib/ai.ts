import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
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

export type Credential = {
  key_reference?: string | null;
  model?: string | null;
  /** When the other provider may take over: rate_limit, timeout, 5xx. Free text. */
  failover_triggers?: string | null;
  /** When true, only projects that opted in may fail over. */
  failover_requires_optin?: boolean | null;
} | null;

export type AiContext = {
  taskId: string;
  /** The tenant's Anthropic credential row, if any. */
  credential: Credential;
  /** The tenant's OpenAI credential row, if any. */
  openai?: Credential;
  /** The project opted in to failover (project_ai_configs.fallback_permitted). */
  failoverPermitted?: boolean;
  monthlyBudget: number | null;
  monthSpend: number;
};

export type Provider = 'anthropic' | 'openai';
export const providerOf = (model: string): Provider =>
  /^(gpt-|o\d)/.test(model) ? 'openai' : 'anthropic';

/**
 * OpenAI list prices, USD per million tokens [input, output]. ESTIMATES — check
 * openai.com/api/pricing and correct them; budgets and cost reports use them.
 */
const OPENAI_PRICES: Record<string, [number, number]> = {
  'gpt-5.5-pro': [30, 180],
  'gpt-5.5': [5, 30],
  'gpt-5.4': [2.5, 15],
  'gpt-5.4-mini': [0.75, 4.5],
  'gpt-5.4-nano': [0.2, 1.25],
};

export function openaiCostOf(model: string, input: number, output: number): number {
  const key = Object.keys(OPENAI_PRICES).find((k) => model === k || model.startsWith(`${k}-`));
  const [i, o] = key ? OPENAI_PRICES[key] : OPENAI_PRICES['gpt-5.5'];
  return (input * i + output * o) / 1_000_000;
}

export async function openaiClientFor(ctx: Pick<AiContext, 'openai'>): Promise<OpenAI> {
  const ref = ctx.openai?.key_reference;
  const apiKey = ref ? await resolveSecret(ref) : process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('no OpenAI key: add one under Connections → AI providers, or set OPENAI_API_KEY');
  }
  return new OpenAI({ apiKey, timeout: 280_000, maxRetries: 1 });
}

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

/** The fallback model on the other provider, by tier. */
function failoverModel(to: Provider, ctx: AiContext, tier: string | null): string {
  if (to === 'openai') return ctx.openai?.model || (tier === 'low' ? 'gpt-5.4-mini' : 'gpt-5.5');
  return ctx.credential?.model || (tier === 'low' ? 'claude-sonnet-5' : 'claude-opus-5-5');
}

/** Which failover trigger an error matches, if any. */
function triggerOf(error: unknown): 'rate_limit' | 'timeout' | '5xx' | null {
  if (error instanceof Anthropic.RateLimitError || error instanceof OpenAI.RateLimitError) return 'rate_limit';
  if (error instanceof Anthropic.APIConnectionTimeoutError || error instanceof OpenAI.APIConnectionTimeoutError) return 'timeout';
  if (error instanceof Anthropic.APIConnectionError || error instanceof OpenAI.APIConnectionError) return '5xx';
  const status = (error as { status?: number }).status;
  if (typeof status === 'number' && status >= 500) return '5xx';
  return null;
}

function mayFailOver(ctx: AiContext, from: Provider, error: unknown): boolean {
  const cred = from === 'anthropic' ? ctx.credential : ctx.openai;
  const other = from === 'anthropic' ? ctx.openai : ctx.credential;
  const trigger = triggerOf(error);
  if (!trigger || !cred?.failover_triggers) return false;
  if (!cred.failover_triggers.toLowerCase().replace(/[^a-z0-9_]+/g, ' ').split(' ').includes(trigger)) return false;
  if (cred.failover_requires_optin !== false && !ctx.failoverPermitted) return false;
  // The other side needs a key: its own credential, or the platform variable.
  return Boolean(other?.key_reference || (from === 'anthropic' ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY));
}

type CallResult = { text: string; model: string; input: number; output: number; cost: number; refused?: boolean; truncated?: boolean };

async function callAnthropic(ctx: AiContext, model: string, effortIn: AgentDefinition['effort'], system: string, prompt: string, schema: Record<string, unknown>, maxTokens: number): Promise<CallResult> {
  const client = await clientFor(ctx);
  const effort = takesEffort(model) ? effortIn : null;
  const request = {
    model,
    max_tokens: maxTokens,
    system,
    ...(takesEffort(model) ? { thinking: { type: 'adaptive' as const } } : {}),
    output_config: {
      format: { type: 'json_schema' as const, schema },
      ...(effort ? { effort } : {}),
    },
    messages: [{ role: 'user' as const, content: prompt }],
  };
  const message = takesFallback(model)
    ? await client.beta.messages
        .stream({ ...request, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
        .finalMessage()
    : await client.messages.stream(request).finalMessage();

  let text = '';
  for (const block of message.content as { type: string; text?: string }[]) {
    if (block.type === 'text' && block.text) text += block.text;
  }
  const input = message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0);
  const output = message.usage.output_tokens;
  return {
    text,
    model: message.model,
    input,
    output,
    cost: costOf(message.model, input, output),
    refused: message.stop_reason === 'refusal',
    truncated: message.stop_reason === 'max_tokens',
  };
}

async function callOpenAI(ctx: AiContext, model: string, effort: AgentDefinition['effort'], system: string, prompt: string, schema: Record<string, unknown>, maxTokens: number): Promise<CallResult> {
  const client = await openaiClientFor(ctx);
  const response = await client.responses.create({
    model,
    instructions: system,
    input: prompt,
    max_output_tokens: maxTokens,
    ...(effort ? { reasoning: { effort } } : {}),
    text: { format: { type: 'json_schema', name: 'agent_output', schema, strict: true } },
    store: false,
  });
  const input = response.usage?.input_tokens ?? 0;
  const output = response.usage?.output_tokens ?? 0;
  return {
    text: response.output_text ?? '',
    model: response.model ?? model,
    input,
    output,
    cost: openaiCostOf(model, input, output),
    truncated: response.status === 'incomplete',
    refused: (response.output ?? []).some((item) =>
      item.type === 'message' && (item.content ?? []).some((c) => c.type === 'refusal')),
  };
}

/**
 * Runs `agent` on `prompt` and returns the parsed JSON matching `schema`.
 *
 * The model comes from the task's tier and decides the provider: Claude
 * (streamed, adaptive thinking, refusal fallback on Opus 5.x) or OpenAI
 * (Responses API, reasoning effort, strict JSON schema). If the call fails for
 * a reason on the credential's failover triggers — and the project opted in
 * where required — the step is retried once on the other provider.
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
  const system = fill(agent.system_prompt ?? `You are the ${agent.display_name}.`, {
    'project.name': params.projectName,
  });
  const maxTokens = params.maxTokens ?? 64000;
  const call = (provider: Provider, m: string) =>
    provider === 'openai'
      ? callOpenAI(ctx, m, agent.effort, system, params.prompt, params.schema, maxTokens)
      : callAnthropic(ctx, m, agent.effort, system, params.prompt, params.schema, maxTokens);

  const started = Date.now();
  const primary = providerOf(model);
  let used: Provider = primary;
  let failover = false;
  let result: CallResult;
  try {
    result = await call(primary, model);
  } catch (error) {
    if (!mayFailOver(ctx, primary, error)) throw error;
    used = primary === 'anthropic' ? 'openai' : 'anthropic';
    failover = true;
    const fallback = failoverModel(used, ctx, agent.tier);
    console.warn(`${agent.key}: ${primary} failed (${triggerOf(error)}); failing over to ${fallback}`);
    result = await call(used, fallback);
  }
  const seconds = (Date.now() - started) / 1000;
  ctx.monthSpend += result.cost;

  const { error } = await serviceClient().rpc('agentsync_record_ai_usage', {
    p_task_id: ctx.taskId,
    p_agent_key: agent.key,
    p_model: result.model,
    p_input_tokens: result.input,
    p_output_tokens: result.output,
    p_cost: result.cost,
    p_duration_seconds: seconds,
    p_provider: used,
    p_failover: failover,
  });
  if (error) console.error('could not record AI usage', error);

  if (result.refused) throw new ModelRefused(`${agent.display_name} declined the request`);
  if (result.truncated) throw new Error(`${agent.display_name} ran out of output tokens before finishing`);

  try {
    return JSON.parse(result.text) as T;
  } catch {
    throw new Error(`${agent.display_name} returned output that is not valid JSON`);
  }
}
