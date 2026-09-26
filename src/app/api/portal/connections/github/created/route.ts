import { Octokit } from '@octokit/rest';
import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { seal } from '@/lib/crypto';
import { PENDING_COOKIE, signPending, verifyPending } from '@/lib/github-state';
import { serviceClient } from '@/lib/supabase';

/**
 * GET /api/portal/connections/github/created?code=…&state=…
 *
 * GitHub has created the App. Trade the one-time code for its id, slug and
 * private key; keep the key encrypted; then send the person straight on to
 * choose which repositories to install it on.
 */

function back(request: NextRequest, problem: string) {
  return NextResponse.redirect(
    new URL(`/portal?screen=connections&github_error=${encodeURIComponent(problem)}`, request.url),
  );
}

export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL('/login', request.url));

  const code = request.nextUrl.searchParams.get('code');
  const pending = verifyPending(request.nextUrl.searchParams.get('state'), user.id);
  if (!code || !pending) return back(request, 'The GitHub link expired or was not started by you. Try again.');

  let app: { id: number; slug?: string; pem: string };
  try {
    const { data } = await new Octokit({ userAgent: 'agentsync' }).apps.createFromManifest({ code });
    app = data as unknown as { id: number; slug?: string; pem: string };
  } catch (e) {
    console.error('manifest conversion failed', e);
    return back(request, 'GitHub did not accept the App code. Try again.');
  }
  if (!app.slug) return back(request, 'GitHub did not return the App name.');

  const sealed = seal(app.pem);
  const { data, error } = await serviceClient().rpc('agentsync_store_secret', {
    p_user_id: user.id,
    p_tenant_slug: pending.tenant_slug,
    p_purpose: `github_app:${app.slug}`,
    p_ciphertext: sealed.ciphertext,
    p_iv: sealed.iv,
    p_tag: sealed.tag,
  });
  const stored = data as { ok: boolean; reference?: string; error?: string } | null;
  if (error || !stored?.ok || !stored.reference) {
    console.error('could not store GitHub App key', error ?? stored);
    return back(request, stored?.error === 'NOT_AUTHORISED'
      ? 'Only a tenant admin can connect GitHub.'
      : 'The App was created but its key could not be stored.');
  }

  const next = signPending({
    user_id: user.id,
    tenant_slug: pending.tenant_slug,
    app_id: app.id,
    slug: app.slug,
    key_ref: stored.reference,
  });
  const response = NextResponse.redirect(
    `https://github.com/apps/${encodeURIComponent(app.slug)}/installations/new`,
  );
  response.cookies.set(PENDING_COOKIE, next, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/api/portal/connections/github',
    maxAge: 3600,
  });
  return response;
}
