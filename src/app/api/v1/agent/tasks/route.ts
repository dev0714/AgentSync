import { NextResponse, type NextRequest } from 'next/server';
import { submitTask, validateSubmission, type SubmitRequest } from '@/lib/tasks';

/**
 * POST /api/v1/agent/tasks — the submission endpoint.
 *
 * Any system that can present a source-system key may submit work here:
 * service desk, intake portal, CRM, cron job, another agent.
 *
 *   Authorization: Bearer ask_live_…
 *   Content-Type: application/json
 *
 * Responds 202 with the task id once the task is queued. A repeated
 * idempotency_key returns 200 and the original task rather than starting a
 * second one — so a caller that retries on a timeout never causes a duplicate
 * branch, pull request or deployment.
 */

/** Every error carries a stable machine-readable code, not just prose. */
const STATUS: Record<string, number> = {
  INVALID_API_KEY: 401,
  SOURCE_DISABLED: 403,
  IP_NOT_ALLOWED: 403,
  PROJECT_NOT_FOUND: 404,
  PROJECT_DISABLED: 409,
  RATE_LIMITED: 429,
  VALIDATION_FAILED: 422,
  INTERNAL_ERROR: 500,
};

function bearer(request: NextRequest): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const [scheme, ...rest] = header.split(' ');
  if (scheme.toLowerCase() !== 'bearer') return null;
  const token = rest.join(' ').trim();
  return token.length > 0 ? token : null;
}

/**
 * The client IP as the platform sees it. Vercel sets x-forwarded-for with the
 * client first; only the first entry is trustworthy, the rest are proxy hops.
 */
function clientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.headers.get('x-real-ip');
}

export async function POST(request: NextRequest) {
  const apiKey = bearer(request);
  if (!apiKey) {
    return NextResponse.json(
      { error: 'INVALID_API_KEY', message: 'Provide a source-system key as a bearer token.' },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'VALIDATION_FAILED', message: 'Body must be JSON.' },
      { status: 422 },
    );
  }

  const problems = validateSubmission(body);
  if (problems.length > 0) {
    return NextResponse.json(
      { error: 'VALIDATION_FAILED', message: 'The payload is not valid.', problems },
      { status: 422 },
    );
  }

  let result;
  try {
    result = await submitTask(apiKey, clientIp(request), body as SubmitRequest);
  } catch (error) {
    console.error('task submission failed', error);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Submission is unavailable. Retry with the same idempotency key.' },
      { status: 500 },
    );
  }

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, message: result.detail ?? undefined },
      { status: STATUS[result.error] ?? 400 },
    );
  }

  // 202 for new work, 200 when an existing task was returned for a repeated key
  return NextResponse.json(
    {
      task_id: result.task_id,
      correlation_id: result.correlation_id,
      status: result.status,
      duplicate: !result.created,
    },
    { status: result.created ? 202 : 200 },
  );
}
