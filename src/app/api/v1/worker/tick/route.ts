import { NextResponse, type NextRequest } from 'next/server';
import { tick } from '@/lib/worker';

// A tick carries tasks through several stages, each of which may call a model.
export const maxDuration = 300;

/**
 * GET|POST /api/v1/worker/tick — drive the queue one step.
 *
 * Deployed on Vercel there is no long-running process, so the loop lives in a
 * cron that calls this. Each call reclaims dead leases, claims at most one
 * task, and advances it one stage. Vercel Cron issues GET, so both verbs are
 * handled; the authentication is identical either way.
 *
 * Protected by CRON_SECRET (which Vercel Cron presents) or WORKER_SECRET rather
 * than a source-system key: this is internal plumbing, not a customer-facing
 * endpoint, and it must never be reachable with a key issued for submitting work.
 */
async function handle(request: NextRequest) {
  // Vercel Cron sends `Authorization: Bearer $CRON_SECRET`; WORKER_SECRET is for
  // calling this by hand. Either is enough, but at least one must be set, and an
  // absent or mismatched secret is never accepted.
  const accepted = [process.env.WORKER_SECRET, process.env.CRON_SECRET].filter((v): v is string => Boolean(v));
  if (accepted.length === 0) {
    console.error('neither CRON_SECRET nor WORKER_SECRET is set; refusing to run the worker');
    return NextResponse.json({ error: 'WORKER_NOT_CONFIGURED' }, { status: 503 });
  }

  const presented =
    request.headers.get('authorization')?.replace(/^Bearer /i, '') ??
    request.headers.get('x-worker-secret');
  if (!presented || !accepted.includes(presented)) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const workerId =
    request.nextUrl.searchParams.get('worker_id') ??
    `worker-${process.env.VERCEL_REGION ?? 'local'}`;

  try {
    return NextResponse.json(await tick(workerId));
  } catch (error) {
    console.error('worker tick failed', error);
    return NextResponse.json({ error: 'TICK_FAILED' }, { status: 500 });
  }
}

export const POST = handle;
export const GET = handle;
