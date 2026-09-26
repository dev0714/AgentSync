import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { connectGithub } from '@/lib/connections';
import { PENDING_COOKIE, verifyPending } from '@/lib/github-state';

/**
 * GET /api/portal/connections/github/installed?installation_id=…&setup_action=…
 *
 * GitHub's return after the App is installed. Records the connection with the
 * App id, the installation, and the encrypted key's reference. The repository
 * allowlist is left empty: the installation itself is limited to the
 * repositories picked on GitHub, and changing that selection later needs no
 * change here.
 */

function to(request: NextRequest, query: string) {
  const response = NextResponse.redirect(new URL(`/portal?screen=connections&${query}`, request.url));
  response.cookies.delete({ name: PENDING_COOKIE, path: '/api/portal/connections/github' });
  return response;
}

export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL('/login', request.url));

  const installationId = Number(request.nextUrl.searchParams.get('installation_id'));
  const pending = verifyPending(request.cookies.get(PENDING_COOKIE)?.value, user.id);

  // A later "configure" on GitHub (adding repositories) lands here too, with
  // nothing pending — the existing connection already covers it.
  if (!pending) {
    return request.nextUrl.searchParams.get('setup_action') === 'update'
      ? to(request, 'github_connected=updated')
      : to(request, `github_error=${encodeURIComponent('The GitHub setup expired. Start again from Connect GitHub.')}`);
  }
  if (!installationId || !pending.app_id || !pending.slug || !pending.key_ref) {
    return to(request, `github_error=${encodeURIComponent('GitHub did not say where the App was installed.')}`);
  }

  const result = await connectGithub(user.id, {
    tenantSlug: pending.tenant_slug,
    appSlug: pending.slug,
    appId: pending.app_id,
    installationId,
    privateKeyReference: pending.key_ref,
    webhookSecretReference: '',
    repositoryAllowlist: [],
    tokenTtlMinutes: 55,
    branchProtectionWrites: false,
  });
  if (!result.ok) {
    return to(request, `github_error=${encodeURIComponent(`Could not record the connection (${result.error}).`)}`);
  }
  return to(request, 'github_connected=1');
}
