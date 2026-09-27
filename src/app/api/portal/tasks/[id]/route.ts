import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { loadTask } from '@/lib/portal-data';
import { serviceClient } from '@/lib/supabase';

/**
 * GET /api/portal/tasks/:id — one task, for the detail screen.
 *
 * The task list arrives with the page; a single task is fetched on demand
 * because it carries the plan, the diff, every command run and the whole event
 * log, and loading that for two hundred tasks nobody opened would be waste.
 *
 * The caller is resolved from the session cookie, never from the request body,
 * and the database function re-checks tenant membership — so a guessed task id
 * from another tenant is indistinguishable from one that does not exist.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  }

  const { id } = await params;
  const detail = await loadTask(user.id, id);
  if (!detail) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  // While the Engineer's sandbox works: how long and what it has cost so far.
  // Read only after loadTask has checked the caller may see this task.
  let live = null;
  if (detail.task.status === 'implementing' || detail.task.status === 'testing') {
    const { data } = await serviceClient().schema('agentsync').from('agent_tasks').select('stage_state').eq('id', id).maybeSingle();
    const st = (data?.stage_state ?? {}) as Record<string, unknown>;
    if (st.session_id) {
      live = {
        started_at: (st.session_started_at as string) ?? null,
        model: (st.session_model as string) ?? null,
        usage: (st.session_usage as { input: number; output: number; costCents: number; polled_at: string } | null) ?? null,
        cap_cents: (st.session_cap_cents as number | null) ?? null,
      };
    }
  }

  // A failed task: where it stopped, and whether Retry can resume the build.
  let retry = null;
  if (detail.task.status === 'failed') {
    const { data } = await serviceClient().rpc('agentsync_retry_point', { p_task_id: id });
    retry = (data as { stage: string | null; plan_version: number | null; can_resume_build: boolean } | null) ?? null;
  }

  return NextResponse.json({ ...detail, live, retry });
}
