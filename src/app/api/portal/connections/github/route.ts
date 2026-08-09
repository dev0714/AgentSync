import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { connectGithub, disconnectGithub } from '@/lib/connections';

/**
 * POST|DELETE /api/portal/connections/github
 *
 * Records or removes the tenant's GitHub App installation from the portal, so
 * connecting no longer means pasting SQL into the Supabase editor.
 *
 * The caller comes from the session cookie and the tenant from the request; the
 * database function re-checks that the caller may configure that tenant, so a
 * hand-made request cannot connect a repository host for someone else.
 */

const STATUS: Record<string, number> = {
  NOT_AUTHORISED: 403,
  NO_SUCH_TENANT: 404,
};

export async function POST(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'BAD_JSON' }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const result = await connectGithub(user.id, {
    tenantSlug: String(b.tenant_slug ?? ''),
    appSlug: String(b.app_slug ?? ''),
    appId: Number(b.app_id ?? 0),
    installationId: Number(b.installation_id ?? 0),
    privateKeyReference: String(b.private_key_reference ?? ''),
    webhookSecretReference: String(b.webhook_secret_reference ?? ''),
    repositoryAllowlist: Array.isArray(b.repository_allowlist)
      ? b.repository_allowlist.map(String)
      : [],
    tokenTtlMinutes: Number(b.token_ttl_minutes ?? 55),
    branchProtectionWrites: Boolean(b.branch_protection_writes),
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, detail: result.detail },
      { status: STATUS[result.error] ?? 422 },
    );
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });

  const slug = request.nextUrl.searchParams.get('tenant');
  if (!slug) return NextResponse.json({ error: 'NO_SUCH_TENANT' }, { status: 404 });

  const result = await disconnectGithub(user.id, slug);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: STATUS[result.error] ?? 422 },
    );
  }
  return NextResponse.json({ ok: true });
}
