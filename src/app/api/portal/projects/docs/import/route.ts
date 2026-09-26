import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { importProjectDoc } from '@/lib/project-docs';
import { serviceClient } from '@/lib/supabase';

export const maxDuration = 300;

/**
 * POST /api/portal/projects/docs/import { tenant_slug } — give every project
 * its AGENTSYNC.md: read it where it exists, otherwise copy the README in and
 * open a pull request. Works through as many as fit in one request and says
 * how many remain; the portal calls again until none do.
 */
export async function POST(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const b = (await request.json().catch(() => ({}))) as { tenant_slug?: string };

  const { data } = await serviceClient().rpc('agentsync_portal_configurable_projects', {
    p_user_id: user.id, p_tenant_slug: String(b.tenant_slug ?? ''),
  });
  if (!data) return NextResponse.json({ error: 'NOT_AUTHORISED' }, { status: 403 });
  const todo = (data as { id: string; name: string; repo_state: string; current_version: number }[])
    .filter((p) => p.current_version === 0 && p.repo_state !== 'pr_open');

  const started = Date.now();
  const results: { name: string; result: string; detail?: string }[] = [];
  for (const p of todo) {
    if (Date.now() - started > 240_000) break;
    const r = await importProjectDoc(p.id).catch((e) => ({ result: 'failed', detail: (e as Error).message }));
    results.push({ name: p.name, ...r });
  }
  return NextResponse.json({ done: results, remaining: todo.length - results.length });
}
