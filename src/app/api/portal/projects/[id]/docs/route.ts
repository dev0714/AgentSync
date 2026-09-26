import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { importProjectDoc, refreshProjectDoc, saveProjectDoc } from '@/lib/project-docs';
import { serviceClient } from '@/lib/supabase';

export const maxDuration = 120;

/**
 * GET  /api/portal/projects/:id/docs?tenant=slug — the project's AGENTSYNC.md,
 *      its version history and its releases.
 * POST { tenant_slug, action } — "import" (first read, or copy the README in),
 *      "refresh" (catch up with the repository), "save" { content, note } or
 *      "restore" { version }: a new version, proposed to the repo by PR.
 */

async function allowed(userId: string, tenantSlug: string, projectId: string): Promise<boolean> {
  const { data } = await serviceClient().rpc('agentsync_portal_project_access', {
    p_user_id: userId, p_tenant_slug: tenantSlug, p_project_id: projectId,
  });
  return data === true;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const { id } = await params;
  const { data, error } = await serviceClient().rpc('agentsync_portal_project_doc', {
    p_user_id: user.id,
    p_tenant_slug: request.nextUrl.searchParams.get('tenant') ?? '',
    p_project_id: id,
  });
  if (error) {
    console.error('project doc failed', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
  const result = data as { ok: boolean; error?: string };
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 403 });
  return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const { id } = await params;

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'BAD_JSON' }, { status: 400 });
  }
  if (!(await allowed(user.id, String(b.tenant_slug ?? ''), id))) {
    return NextResponse.json({ error: 'NOT_AUTHORISED' }, { status: 403 });
  }

  try {
    switch (b.action) {
      case 'import':
        return NextResponse.json(await importProjectDoc(id));
      case 'refresh':
        return NextResponse.json({ state: await refreshProjectDoc(id) });
      case 'save': {
        const content = typeof b.content === 'string' ? b.content : '';
        if (!content.trim()) return NextResponse.json({ error: 'CONTENT_REQUIRED' }, { status: 422 });
        if (content.length > 200_000) return NextResponse.json({ error: 'TOO_LONG' }, { status: 422 });
        const note = typeof b.note === 'string' ? b.note.trim().slice(0, 300) || null : null;
        return NextResponse.json(await saveProjectDoc(id, content, { userId: user.id, source: 'person', note }));
      }
      case 'restore': {
        const version = Number(b.version);
        const { data } = await serviceClient().rpc('agentsync_portal_doc_version', {
          p_user_id: user.id, p_tenant_slug: String(b.tenant_slug ?? ''), p_project_id: id, p_version: version,
        });
        const v = (data as { version?: { content: string } | null } | null)?.version;
        if (!v) return NextResponse.json({ error: 'NO_SUCH_VERSION' }, { status: 404 });
        return NextResponse.json(await saveProjectDoc(id, v.content, {
          userId: user.id, source: 'restore', note: `Restored version ${version}`,
        }));
      }
      default:
        return NextResponse.json({ error: 'UNKNOWN_ACTION' }, { status: 422 });
    }
  } catch (e) {
    console.error('project doc action failed', e);
    return NextResponse.json({ error: 'GITHUB_ERROR', detail: (e as Error).message.slice(0, 300) }, { status: 502 });
  }
}
