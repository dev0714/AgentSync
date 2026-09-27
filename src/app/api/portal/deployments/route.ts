import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { serviceClient } from '@/lib/supabase';
import { syncDeployments } from '@/lib/vercel';

/**
 * GET /api/portal/deployments?tenant=slug[&refresh=1] — the tenant's
 * deployments, newest first, with the project and task behind each. Reads
 * the latest from the deployment provider first (at most once a minute, or
 * now with refresh=1).
 */

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const tenant = request.nextUrl.searchParams.get('tenant') ?? '';
  const sync = await syncDeployments(user.id, tenant, request.nextUrl.searchParams.get('refresh') === '1');
  if ('denied' in sync) return NextResponse.json({ error: sync.error }, { status: 403 });

  const { data, error } = await serviceClient().rpc('agentsync_portal_deployments', { p_user_id: user.id, p_tenant_slug: tenant });
  if (error) return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  const r = data as { ok: boolean; error?: string; deployments?: unknown[] };
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 403 });
  return NextResponse.json({ ok: true, deployments: r.deployments ?? [], sync }, { headers: { 'cache-control': 'private, no-store' } });
}
