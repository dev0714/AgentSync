import 'server-only';
import {
  claimNextTask,
  heartbeat,
  reclaimExpiredTasks,
  transitionTask,
  type ClaimedTask,
} from './tasks';
import { recall, renderMemoryBlock } from './memory';

/**
 * The worker harness: claim a task, hold the lease, advance it one stage,
 * release it.
 *
 * Deployed on Vercel there is no long-running process, so this is written as a
 * single tick meant to be driven by a cron. Each tick reclaims dead leases,
 * takes at most one task, and runs exactly one stage — the loop lives in the
 * scheduler rather than in memory, which also means a crashed tick loses
 * nothing: the lease expires and the task returns to the queue.
 *
 * Stage implementations are pluggable. The ones that need infrastructure that
 * doesn't exist yet (a repository checkout, an LLM key) refuse loudly rather
 * than pretending to succeed — a stage that silently no-ops would move a task
 * forward with nothing behind it, which is the one failure mode this pipeline
 * must not have.
 */

export class StageNotConfigured extends Error {
  readonly code: string;
  constructor(stage: string, missing: string) {
    super(`${stage} needs ${missing}`);
    this.code = 'STAGE_NOT_CONFIGURED';
    this.name = 'StageNotConfigured';
  }
}

export type StageContext = {
  task: ClaimedTask;
  workerId: string;
  /** Extends the lease; call during anything slow. */
  keepAlive: () => Promise<boolean>;
};

/** A stage advances a task and returns the status to move it to. */
export type Stage = (ctx: StageContext) => Promise<string>;

/**
 * Reads the repository and gathers the context the planner will need. Requires
 * a GitHub App installation and a checkout workspace — neither exists yet.
 */
export const analyse: Stage = async () => {
  throw new StageNotConfigured('analyse', 'a GitHub App installation and a checkout workspace');
};

/**
 * Produces the implementation plan.
 *
 * The memory layer is already wired here: the planner is given what the
 * project learned from earlier tasks, including previous edits to the paths it
 * is about to touch. What is missing is the model call itself.
 */
export const plan: Stage = async ({ task }) => {
  // Memory is real and queryable today, so gather it even though the model
  // call below is not yet wired — it makes the missing piece obvious.
  const memory = await recall(task.project_id, null, 25);
  const block = renderMemoryBlock(memory);
  void block;

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new StageNotConfigured('plan', 'ANTHROPIC_API_KEY');
  }
  throw new StageNotConfigured('plan', 'a provider adapter');
};

export const STAGES: Record<string, Stage> = {
  analysing: analyse,
  planning: plan,
};

export type TickResult =
  | { worked: false; reclaimed: number; reason: 'queue_empty' }
  | {
      worked: true;
      reclaimed: number;
      task_id: string;
      from: string;
      to: string | null;
      error?: string;
    };

/**
 * One unit of work. Safe to call concurrently: the claim is atomic, so two
 * ticks never take the same task.
 */
export async function tick(workerId: string, leaseSeconds = 1800): Promise<TickResult> {
  const reclaimed = await reclaimExpiredTasks();

  const task = await claimNextTask(workerId, leaseSeconds);
  if (!task) return { worked: false, reclaimed, reason: 'queue_empty' };

  // claim_next_task leaves the task in `analysing`
  const from = 'analysing';
  const stage = STAGES[from];

  const ctx: StageContext = {
    task,
    workerId,
    keepAlive: () => heartbeat(task.task_id, workerId, leaseSeconds),
  };

  try {
    const to = await stage(ctx);
    await transitionTask({
      taskId: task.task_id,
      to,
      actor: workerId,
      workerId,
      message: `${from} complete`,
    });
    return { worked: true, reclaimed, task_id: task.task_id, from, to };
  } catch (error) {
    const code = error instanceof StageNotConfigured ? error.code : 'STAGE_FAILED';
    const detail = error instanceof Error ? error.message : String(error);

    // Fail the task explicitly rather than leaving it to time out — a task
    // that cannot proceed should say so now, with the reason on the record.
    await transitionTask({
      taskId: task.task_id,
      to: 'failed',
      actor: workerId,
      workerId,
      message: `${code}: ${detail}`,
    }).catch((e) => console.error('could not record stage failure', e));

    return {
      worked: true,
      reclaimed,
      task_id: task.task_id,
      from,
      to: 'failed',
      error: `${code}: ${detail}`,
    };
  }
}
