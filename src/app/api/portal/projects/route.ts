import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { serviceClient } from '@/lib/supabase';

/**
 * POST /api/portal/projects — create a project and its repository.
 *
 * The tenant comes from the request; the database function re-checks that the
 * session user may configure it.
 */

const STATUS: Record<string, number> = {
  NOT_AUTHORISED: 403,
  PROJECT_EXISTS: 409,
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

  const { data, error } = await serviceClient().rpc('agentsync_create_project', {
    p_user_id: user.id,
    p_tenant_slug: String(b.tenant_slug ?? ''),
    p_name: String(b.name ?? ''),
    p_github_owner: String(b.github_owner ?? ''),
    p_repository: String(b.repository ?? ''),
    p_default_branch: String(b.default_branch ?? 'main'),
    p_plan_approval_required: b.plan_approval_required !== false,
  });
  if (error) {
    console.error('create project failed', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
  const result = data as { ok: boolean; error?: string; project_id?: string };
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: STATUS[result.error ?? ''] ?? 422 });
  }
  return NextResponse.json(result);
}
