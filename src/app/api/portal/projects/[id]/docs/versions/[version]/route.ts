import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { serviceClient } from '@/lib/supabase';

/** GET /api/portal/projects/:id/docs/versions/:version?tenant=slug — one version's text. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; version: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const { id, version } = await params;
  const { data, error } = await serviceClient().rpc('agentsync_portal_doc_version', {
    p_user_id: user.id,
    p_tenant_slug: request.nextUrl.searchParams.get('tenant') ?? '',
    p_project_id: id,
    p_version: Number(version),
  });
  if (error) return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  const result = data as { ok: boolean; error?: string; version?: unknown };
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 403 });
  if (!result.version) return NextResponse.json({ error: 'NO_SUCH_VERSION' }, { status: 404 });
  return NextResponse.json(result.version, { headers: { 'cache-control': 'no-store' } });
}
