import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { kickWorker } from '@/lib/kick';
import { serviceClient } from '@/lib/supabase';
import { validateSubmission } from '@/lib/tasks';

/**
 * POST /api/portal/tasks — submit a request from a project in the portal.
 *
 *   { project_id, title, description?, request_type?, priority?, acceptance_criteria? }
 *
 * The same pipeline as the API endpoint, attributed to the signed-in person
 * rather than a source system. Validation is shared with the API, so both
 * reject the same things; the database checks the person's role.
 */

export const maxDuration = 300;

const STATUS: Record<string, number> = {
  NOT_AUTHORISED: 403,
  PROJECT_NOT_FOUND: 404,
  PROJECT_DISABLED: 409,
};

export async function POST(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'BAD_JSON' }, { status: 400 });
  }

  const problems = validateSubmission({ ...b, idempotency_key: 'portal' });
  if (problems.length) {
    return NextResponse.json({ error: 'VALIDATION_FAILED', problems }, { status: 422 });
  }

  const { data, error } = await serviceClient().rpc('agentsync_portal_submit_task', {
    p_user_id: user.id,
    p_project_id: String(b.project_id),
    p_title: String(b.title).trim(),
    p_description: typeof b.description === 'string' ? b.description : null,
    p_request_type: typeof b.request_type === 'string' ? b.request_type : 'code_change',
    p_priority: typeof b.priority === 'string' ? b.priority : 'normal',
    p_acceptance_criteria: Array.isArray(b.acceptance_criteria)
      ? (b.acceptance_criteria as string[]).map((c) => c.trim()).filter(Boolean)
      : [],
  });
  if (error) {
    console.error('portal submit failed', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }

  const result = data as { ok: boolean; error?: string; task_id?: string };
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: STATUS[result.error ?? ''] ?? 422 });
  }

  kickWorker('portal');
  return NextResponse.json({ task_id: result.task_id }, { status: 201 });
}
