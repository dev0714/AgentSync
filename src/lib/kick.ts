import 'server-only';
import { after } from 'next/server';
import { tick } from './worker';

/**
 * Starts the worker right after this response is sent, so a new task or a
 * decision is acted on immediately instead of at the next cron tick. The cron
 * stays as the backstop — if this run dies, the lease expires and the next
 * tick resumes the task.
 */
export function kickWorker(reason: string) {
  after(async () => {
    try {
      await tick(`kick-${reason}-${process.env.VERCEL_REGION ?? 'local'}`);
    } catch (error) {
      console.error('worker kick failed', error);
    }
  });
}
