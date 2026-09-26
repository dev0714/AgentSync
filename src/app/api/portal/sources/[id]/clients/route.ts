import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { serviceClient } from '@/lib/supabase';

/**
 * GET /api/portal/sources/:id/clients?tenant=slug — the source's clients and
 * the projects they can be mapped to.
 * PUT { tenant_slug, external_id, projects: [{ project_id, hint? }] } — set a
 * client's repositories (an empty list unmaps it).
 */

const STATUS: Record<string, number> = { NOT_AUTHORISED: 403, PROJECT_NOT_FOUND: 404, CLIENT_NOT_FOUND: 404 };

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const { id } = await params;

  const { data, error } = await serviceClient().rpc('agentsync_portal_source_clients', {
    p_user_id: user.id,
    p_tenant_slug: request.nextUrl.searchParams.get('tenant') ?? '',
    p_source_id: id,
  });
  if (error) {
    console.error('source clients failed', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
  const result = data as { ok: boolean; error?: string };
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: STATUS[result.error ?? ''] ?? 422 });
  return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const { id } = await params;

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'BAD_JSON' }, { status: 400 });
  }
  // [{ project_id, hint? }]: the client's repositories, replacing what it had.
  const projects = Array.isArray(b.projects)
    ? (b.projects as Record<string, unknown>[])
        .filter((p) => p && typeof p.project_id === 'string' && p.project_id)
        .map((p) => ({ project_id: String(p.project_id), hint: typeof p.hint === 'string' ? p.hint.slice(0, 300) : null }))
    : [];

  const { data, error } = await serviceClient().rpc('agentsync_portal_set_client_projects', {
    p_user_id: user.id,
    p_tenant_slug: String(b.tenant_slug ?? ''),
    p_source_id: id,
    p_external_id: String(b.external_id ?? ''),
    p_projects: projects,
  });
  if (error) {
    console.error('map source client failed', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
  const result = data as { ok: boolean; error?: string };
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: STATUS[result.error ?? ''] ?? 422 });
  return NextResponse.json({ ok: true });
}
