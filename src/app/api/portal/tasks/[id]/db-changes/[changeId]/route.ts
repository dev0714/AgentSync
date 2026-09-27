import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { resolveSecret } from '@/lib/secrets';
import { readTaskBranchFile } from '@/lib/stages';
import { runSql } from '@/lib/supabase-mgmt';
import { serviceClient } from '@/lib/supabase';

/**
 * POST /api/portal/tasks/:id/db-changes/:changeId — a change's database script.
 *
 *   { "action": "run" }            run it on the project's linked Supabase project
 *   { "action": "mark_applied" }   it was applied another way
 *
 * Only an approver or admin of the task's tenant, checked before anything
 * runs. The SQL is read from the task's branch as it is now, so what runs is
 * what is about to be merged.
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
  const db = serviceClient();

  const { data: allowed } = await db.rpc('agentsync_can_approve', { p_user_id: user.id, p_task_id: id });
  if (!allowed) return NextResponse.json({ error: 'NOT_AUTHORISED' }, { status: 403 });

  const { data: list } = await db.rpc('agentsync_db_changes_for', { p_task_id: id });
  const change = ((list ?? []) as { id: string; path: string; status: string }[]).find((c) => c.id === changeId);
  if (!change) return NextResponse.json({ error: 'NO_SUCH_CHANGE' }, { status: 404 });

  const mark = async (status: 'applied' | 'marked_applied' | 'failed', output: string | null) => {
    const { data, error } = await db.rpc('agentsync_db_change_mark', {
      p_user_id: user.id,
      p_change_id: changeId,
      p_status: status,
      p_output: output,
    });
    return !error && (data as { ok?: boolean } | null)?.ok;
  };

  if (body.action === 'mark_applied') {
    return (await mark('marked_applied', null))
      ? NextResponse.json({ ok: true, status: 'marked_applied' })
      : NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
  if (body.action !== 'run') return NextResponse.json({ error: 'UNKNOWN_ACTION' }, { status: 422 });

  const { data: cfgData } = await db.rpc('agentsync_task_database', { p_task_id: id });
  const cfg = (cfgData ?? {}) as { token_reference?: string | null; supabase_project_ref?: string | null };
  if (!cfg.token_reference) return NextResponse.json({ error: 'NOT_CONNECTED' }, { status: 409 });
  if (!cfg.supabase_project_ref) return NextResponse.json({ error: 'NO_PROJECT_LINKED' }, { status: 409 });

  let token: string;
  try {
    token = await resolveSecret(cfg.token_reference);
  } catch (e) {
    return NextResponse.json({ error: 'SECRET_UNAVAILABLE', detail: (e as Error).message }, { status: 422 });
  }
  const sql = await readTaskBranchFile(id, change.path);
  if (!sql?.trim()) return NextResponse.json({ error: 'SCRIPT_NOT_FOUND' }, { status: 404 });

  const result = await runSql(token, cfg.supabase_project_ref, sql);
  if (!result.ok) {
    await mark('failed', result.error);
    return NextResponse.json({ error: 'RUN_FAILED', detail: result.error }, { status: 422 });
  }
  await mark('applied', `Ran on ${cfg.supabase_project_ref}: ${result.result}`);
  return NextResponse.json({ ok: true, status: 'applied' });
}
