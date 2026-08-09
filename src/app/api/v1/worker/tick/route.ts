import { NextResponse, type NextRequest } from 'next/server';
import { tick } from '@/lib/worker';

/**
 * GET|POST /api/v1/worker/tick — drive the queue one step.
 *
 * Deployed on Vercel there is no long-running process, so the loop lives in a
 * cron that calls this. Each call reclaims dead leases, claims at most one
 * task, and advances it one stage. Vercel Cron issues GET, so both verbs are
 * handled; the authentication is identical either way.
 *
 * Protected by WORKER_SECRET rather than a source-system key: this is internal
 * plumbing, not a customer-facing endpoint, and it must never be reachable
 * with a key that was issued for submitting work.
 */
async function handle(request: NextRequest) {
  const secret = process.env.WORKER_SECRET;
  if (!secret) {
    console.error('WORKER_SECRET is not set; refusing to run the worker');
    return NextResponse.json({ error: 'WORKER_NOT_CONFIGURED' }, { status: 503 });
  }

  const presented =
    request.headers.get('authorization')?.replace(/^Bearer /i, '') ??
    request.headers.get('x-worker-secret');

  // Vercel Cron sends `Authorization: Bearer $CRON_SECRET`, so that one is
  // accepted too when it is set — but never an absent or mismatched secret.
  const accepted = [secret, process.env.CRON_SECRET].filter(Boolean);
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
