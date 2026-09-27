import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { applyDbChange, dbChangesFor, DbChangeError, markDbChangeApplied } from '@/lib/db-changes';
import { serviceClient } from '@/lib/supabase';

/**
 * POST /api/portal/tasks/:id/db-changes/:changeId — a change's database script.
 *
 *   { "action": "run" }            run it on the project's linked Supabase project
 *   { "action": "mark_applied" }   it was applied another way
 *
 * Only an approver or admin of the task's tenant, checked before anything
 * runs. Approving the merge runs any still pending, so this is for running
 * one ahead of that, or recording one applied by hand.
 */

export const maxDuration = 120;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; changeId: string }> },
) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const { id, changeId } = await params;
  const body = (await request.json().catch(() => ({}))) as { action?: string };

  const { data: allowed } = await serviceClient().rpc('agentsync_can_approve', { p_user_id: user.id, p_task_id: id });
  if (!allowed) return NextResponse.json({ error: 'NOT_AUTHORISED' }, { status: 403 });

  const change = (await dbChangesFor(id)).find((c) => c.id === changeId);
  if (!change) return NextResponse.json({ error: 'NO_SUCH_CHANGE' }, { status: 404 });

  try {
    if (body.action === 'mark_applied') {
      await markDbChangeApplied(user.id, change);
      return NextResponse.json({ ok: true, status: 'marked_applied' });
    }
    if (body.action !== 'run') return NextResponse.json({ error: 'UNKNOWN_ACTION' }, { status: 422 });
    await applyDbChange(id, user.id, change);
    return NextResponse.json({ ok: true, status: 'applied' });
  } catch (e) {
    if (e instanceof DbChangeError) return NextResponse.json({ error: e.code, detail: e.message }, { status: e.status });
    throw e;
  }
}
