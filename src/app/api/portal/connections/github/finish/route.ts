import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { finishGithubConnection } from '@/lib/github-connect';
import { serviceClient } from '@/lib/supabase';

/**
 * GET  /api/portal/connections/github/finish?tenant=<slug>
 *   One-click Apps for this tenant whose key is stored but never connected.
 * POST /api/portal/connections/github/finish  { key_ref, app_id? }
 *   Finishes one of them, checking the App id against the stored key.
 */

type Unfinished = { tenant_slug: string; app_slug: string; app_id: number | null; key_ref: string };

async function unfinished(userId: string): Promise<Unfinished[]> {
  const { data, error } = await serviceClient().rpc('agentsync_unfinished_github_apps', { p_user_id: userId });
  if (error) throw error;
  return (data ?? []) as Unfinished[];
}

export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const tenant = request.nextUrl.searchParams.get('tenant');
  const apps = (await unfinished(user.id))
    .filter((a) => !tenant || a.tenant_slug === tenant)
    .map(({ app_slug, app_id, key_ref }) => ({ app_slug, app_id, key_ref }));
  return NextResponse.json({ apps }, { headers: { 'cache-control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'BAD_JSON' }, { status: 400 });
  }

  // Only a key this user may finish, found server-side — never a reference
  // taken on trust from the request.
  const app = (await unfinished(user.id)).find((a) => a.key_ref === b.key_ref);
  if (!app) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  const appId = app.app_id ?? Number(b.app_id);
  if (!appId || !Number.isInteger(appId)) {
    return NextResponse.json({ error: 'APP_ID_REQUIRED' }, { status: 422 });
  }

  try {
    const result = await finishGithubConnection({
      userId: user.id,
      tenantSlug: app.tenant_slug,
      appSlug: app.app_slug,
      appId,
      keyRef: app.key_ref,
    });
    if (!result.ok) return NextResponse.json(result, { status: 422 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('finish GitHub connection failed', e);
    return NextResponse.json({ error: 'GITHUB_UNREACHABLE' }, { status: 502 });
  }
}
