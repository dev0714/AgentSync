import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { finishGithubConnection } from '@/lib/github-connect';
import { PENDING_COOKIE, verifyPending } from '@/lib/github-state';
import { serviceClient } from '@/lib/supabase';

/**
 * GET /api/portal/connections/github/installed?installation_id=…&setup_action=…
 *
 * GitHub's return after the App is installed, or after its repository
 * selection is changed. Records (or refreshes) the tenant's connection, with
 * the repositories GitHub reports for the installation as the allowlist.
 */

function to(request: NextRequest, query: string, clearCookie: boolean) {
  const response = NextResponse.redirect(new URL(`/portal?screen=connections&${query}`, request.url));
  if (clearCookie) {
    response.cookies.delete({ name: PENDING_COOKIE, path: '/api/portal/connections/github' });
  }
  return response;
}

const fail = (request: NextRequest, text: string) =>
  to(request, `github_error=${encodeURIComponent(text)}`, false);

export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL('/login', request.url));

  const installationId = Number(request.nextUrl.searchParams.get('installation_id')) || null;
  const pending = verifyPending(request.cookies.get(PENDING_COOKIE)?.value, user.id);

  try {
    if (pending?.app_id && pending.slug && pending.key_ref) {
      const result = await finishGithubConnection({
        userId: user.id,
        tenantSlug: pending.tenant_slug,
        appSlug: pending.slug,
        appId: pending.app_id,
        keyRef: pending.key_ref,
        installationId,
      });
      return result.ok
        ? to(request, 'github_connected=1', true)
        : fail(request, result.detail ?? `Could not record the connection (${result.error}).`);
    }

    // Nothing pending: the repository selection was changed on GitHub.
    // Refresh the allowlist of the connection this installation belongs to.
    if (installationId) {
      const { data } = await serviceClient().rpc('agentsync_github_connection_for_installation', {
        p_user_id: user.id,
        p_installation_id: installationId,
      });
      const existing = data as { tenant_slug: string; app_slug: string; app_id: number; key_ref: string } | null;
      if (existing?.app_id) {
        const result = await finishGithubConnection({
          userId: user.id,
          tenantSlug: existing.tenant_slug,
          appSlug: existing.app_slug,
          appId: existing.app_id,
          keyRef: existing.key_ref,
          installationId,
        });
        return result.ok
          ? to(request, 'github_connected=updated', true)
          : fail(request, result.detail ?? `Could not update the connection (${result.error}).`);
      }
    }
  } catch (e) {
    console.error('finishing GitHub connection failed', e);
    return fail(request, 'Could not reach GitHub to finish the connection. Use "Finish connecting" to retry.');
  }

  return fail(request, 'The GitHub setup expired. Use "Finish connecting" below, or start again.');
}
