import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { loadTask } from '@/lib/portal-data';

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

  return NextResponse.json(detail);
}
