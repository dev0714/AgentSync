import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { serviceClient } from '@/lib/supabase';

/**
 * GET /api/portal/usage?tenant=slug — this month's AI spend by day (per
 * provider), by agent and by project, for the Usage and cost screen.
 */
export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const { data, error } = await serviceClient().rpc('agentsync_portal_usage_detail', {
    p_user_id: user.id,
    p_tenant_slug: request.nextUrl.searchParams.get('tenant') ?? '',
  });
  if (error) return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  const result = data as { ok: boolean; error?: string };
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 403 });
  return NextResponse.json(result, { headers: { 'cache-control': 'private, no-store' } });
}
