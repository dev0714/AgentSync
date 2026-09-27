import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { serviceClient } from '@/lib/supabase';

/**
 * GET /api/portal/usage?tenant=slug[&project=id] — this month's AI spend by
 * day (per provider), by agent, by project and by ticket, for the Usage and
 * cost screen; narrowed to one project when one is given.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const project = request.nextUrl.searchParams.get('project') ?? '';
  const { data, error } = await serviceClient().rpc('agentsync_portal_usage_detail', {
    p_user_id: user.id,
    p_tenant_slug: request.nextUrl.searchParams.get('tenant') ?? '',
    p_project_id: UUID.test(project) ? project : null,
  });
  if (error) return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  const result = data as { ok: boolean; error?: string };
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 403 });
  return NextResponse.json(result, { headers: { 'cache-control': 'private, no-store' } });
}
