import 'server-only';
import { serviceClient } from './supabase';
import {
  claimNextTask,
  heartbeat,
  reclaimExpiredTasks,
  transitionTask,
} from './tasks';
import { STAGES, StageFailed, loadJob, logEvent, sendCallback } from './stages';

/**
 * The worker harness: claim a task, run the stage for its current status,
 * move it on, and keep going while there is time.
 *
 * Deployed on Vercel there is no long-running process, so this runs inside a
 * request — a cron tick, or a kick after a submission or a decision. A crashed
 * tick loses nothing: the lease expires and the task is resumed, in the status
 * it had reached, by the next one.
 *
 * Stages never change status themselves. They return where the task goes next
 * and this harness makes the move, so a gate cannot be skipped from inside a
 * stage — and the database refuses human-only moves from the worker anyway.
 */

/** Stop starting new stages after this long, leaving room inside maxDuration. */
const BUDGET_MS = 200_000;
const LEASE_SECONDS = 900;
const WORKING = new Set(Object.keys(STAGES));

export type TickResult = {
  reclaimed: number;
  steps: { task_id: string; from: string; to?: string; waiting?: number; error?: string }[];
};

async function release(taskId: string, workerId: string, delaySeconds = 0) {
  const { error } = await serviceClient().rpc('agentsync_release_task', {
    p_task_id: taskId,
    p_worker_id: workerId,
    p_delay_seconds: delaySeconds,
  });
  if (error) console.error('could not release task', error);
}

export async function tick(workerId: string): Promise<TickResult> {
  const started = Date.now();
  const result: TickResult = { reclaimed: await reclaimExpiredTasks(), steps: [] };

  while (Date.now() - started < BUDGET_MS) {
    const claimed = await claimNextTask(workerId, LEASE_SECONDS);
    if (!claimed) break;

    let status = claimed.status;
    const taskId = claimed.task_id;

    // Carry this task as far as it will go before picking up another.
    while (WORKING.has(status) && Date.now() - started < BUDGET_MS) {
      const from = status;
      try {
        await heartbeat(taskId, workerId, LEASE_SECONDS);
        const job = await loadJob(taskId);
        const outcome = await STAGES[from](job);

        if ('wait' in outcome) {
          await release(taskId, workerId, outcome.wait);
          result.steps.push({ task_id: taskId, from, waiting: outcome.wait });
          status = '';
          break;
        }

        await transitionTask({
          taskId,
          to: outcome.to,
          actor: workerId,
          workerId,
          message: outcome.message,
        });
        result.steps.push({ task_id: taskId, from, to: outcome.to });
        status = outcome.to;
      } catch (error) {
        const code = error instanceof StageFailed ? error.code
          : (error as { code?: string }).code && typeof (error as { code?: string }).code === 'string'
            && /^[A-Z_]+$/.test((error as { code: string }).code) ? (error as { code: string }).code
          : 'STAGE_FAILED';
        const detail = error instanceof Error ? error.message : String(error);
        console.error(`stage ${from} failed for ${taskId}`, error);

        // Fail the task with the reason on record, rather than leaving it to
        // time out and be retried into the same wall.
        await serviceClient().rpc('agentsync_update_task', { p_task_id: taskId, p_fields: { error_code: code } });
        await transitionTask({
          taskId,
          to: 'failed',
          actor: workerId,
          workerId,
          message: `${code}: ${detail}`.slice(0, 2000),
        }).catch((e) => console.error('could not record stage failure', e));
        await loadJob(taskId)
          .then((job) => sendCallback(job, 'failed', `${code}: ${detail}`))
          .catch(() => undefined);
        await logEvent(taskId, 'agent.failed', `${from} failed: ${detail}`.slice(0, 2000), { code });

        result.steps.push({ task_id: taskId, from, to: 'failed', error: `${code}: ${detail}` });
        status = 'failed';
      }
    }

    // Paused at a gate, or out of time mid-pipeline: let go so the next
    // decision or tick can pick it up. (Terminal statuses already cleared it.)
    if (status) await release(taskId, workerId);
  }

  return result;
}
