import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { suggestForProject, type Suggestion } from '@/lib/supabase-link';
import { serviceClient } from '@/lib/supabase';

/**
 * POST /api/portal/connections/supabase/suggest { tenant_slug }
 *
 * For every project of the tenant, the Supabase project its repository names
 * (among those the connection can see). Nothing is saved: the person reviews
 * the list and links what is right through /api/portal/projects/:id/database.
 */

export const maxDuration = 120;

type Repo = { github_owner: string; repository: string; supabase_project_ref: string | null };

export async function POST(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const b = (await request.json().catch(() => ({}))) as { tenant_slug?: string };
  const slug = String(b.tenant_slug ?? '');
  const db = serviceClient();

  const { data: connData } = await db.rpc('agentsync_supabase_connection', { p_user_id: user.id, p_tenant_slug: slug });
  const conn = connData as { ok?: boolean; can_edit?: boolean; connection?: { projects: { ref: string }[] } | null } | null;
  if (!conn?.ok || !conn.can_edit) return NextResponse.json({ error: 'NOT_AUTHORISED' }, { status: 403 });
  if (!conn.connection) return NextResponse.json({ error: 'NOT_CONNECTED' }, { status: 409 });
  const visible = new Set(conn.connection.projects.map((p) => p.ref));

  const { data: tenant } = await db.schema('agentsync').from('tenants').select('id').eq('slug', slug).maybeSingle();
  const { data: projects } = await db
    .schema('agentsync')
    .from('projects')
    .select('id, name, project_repositories(github_owner, repository, supabase_project_ref)')
    .eq('tenant_id', (tenant as { id: string } | null)?.id ?? '')
    .order('name');
  const list = (projects ?? []) as { id: string; name: string; project_repositories: Repo[] | Repo | null }[];

  // A few repositories at a time: each is a handful of small GitHub reads.
  const results: Suggestion[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < list.length) {
      const p = list[next++];
      results.push(await Promise.race([
        suggestForProject(p.id, visible),
        new Promise<Suggestion>((resolve) =>
          setTimeout(() => resolve({ project_id: p.id, ref: null, source: null, unseen: null, error: 'timed out' }), 20_000)),
      ]));
    }
  }));

  const byId = new Map(results.map((r) => [r.project_id, r]));
  return NextResponse.json({
    ok: true,
    projects: list.map((p) => {
      const repo = Array.isArray(p.project_repositories) ? p.project_repositories[0] : p.project_repositories;
      const s = byId.get(p.id);
      return {
        project_id: p.id,
        name: p.name,
        repository: repo ? `${repo.github_owner}/${repo.repository}` : null,
        linked: repo?.supabase_project_ref ?? null,
        suggested: s?.ref ?? null,
        source: s?.source ?? null,
        unseen: s?.unseen ?? null,
        error: s?.error ?? null,
      };
    }),
  });
}
