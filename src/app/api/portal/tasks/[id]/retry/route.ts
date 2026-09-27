import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { kickWorker } from '@/lib/kick';
import { serviceClient } from '@/lib/supabase';

/**
 * POST /api/portal/tasks/:id/retry — send a failed task back to the queue.
 *
 *   { "comment"?: string }
 *
 * It starts again from Analyse on the same task, so the source system keeps
 * hearing about the same ticket. The database function checks the person may
 * approve work for the task's tenant and that the task really has failed.
 */

const STATUS: Record<string, number> = {
  NOT_AUTHORISED: 403,
  NO_SUCH_TASK: 404,
  NOT_FAILED: 409,
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { comment?: unknown };
  const { id } = await params;
  const { data, error } = await serviceClient().rpc('agentsync_retry_task', {
    p_user_id: user.id,
    p_task_id: id,
    p_comment: typeof body.comment === 'string' ? body.comment : null,
  });
  if (error) {
    console.error('retry failed', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }

  const result = data as { ok: boolean; error?: string; detail?: string; status?: string };
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, detail: result.detail },
      { status: STATUS[result.error ?? ''] ?? 422 },
    );
  }

  kickWorker('retry');
  return NextResponse.json({ ok: true, status: result.status });
}
