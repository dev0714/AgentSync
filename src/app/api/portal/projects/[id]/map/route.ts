import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { kickWorker } from '@/lib/kick';
import { MAP_BUCKET, mapsAvailable, queueMap } from '@/lib/project-maps';
import { serviceClient } from '@/lib/supabase';

// Starting a map runs in the background after the response.
export const maxDuration = 300;

/**
 * GET  /api/portal/projects/:id/map?tenant=slug — the project's code map:
 *      status, stats and the GRAPH_REPORT.md text.
 * POST { tenant_slug } — map it now (only changed files are re-parsed).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const { id } = await params;
  const { data, error } = await serviceClient().rpc('agentsync_portal_project_map', {
    p_user_id: user.id,
    p_tenant_slug: request.nextUrl.searchParams.get('tenant') ?? '',
    p_project_id: id,
  });
  if (error) return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  const result = data as { ok: boolean; error?: string; map: { files?: Record<string, number> | null } | null };
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 403 });

  let report: string | null = null;
  if (result.map?.files?.['GRAPH_REPORT.md']) {
    const { data: file } = await serviceClient().storage.from(MAP_BUCKET).download(`${id}/GRAPH_REPORT.md`);
    report = file ? (await file.text()).slice(0, 400_000) : null;
  }
  return NextResponse.json({ map: result.map, report, available: mapsAvailable() }, { headers: { 'cache-control': 'no-store' } });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const { id } = await params;
  const b = (await request.json().catch(() => ({}))) as { tenant_slug?: string };
  const { data: ok } = await serviceClient().rpc('agentsync_portal_project_access', {
    p_user_id: user.id, p_tenant_slug: String(b.tenant_slug ?? ''), p_project_id: id,
  });
  if (ok !== true) return NextResponse.json({ error: 'NOT_AUTHORISED' }, { status: 403 });
  await queueMap(id, 'person');
  kickWorker('map');
  return NextResponse.json({ ok: true });
}
