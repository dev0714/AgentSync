import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { encryptionConfigured } from '@/lib/crypto';
import { signPending } from '@/lib/github-state';

/**
 * GET /api/portal/connections/github/manifest?tenant=<slug>&org=<optional>
 *
 * Everything the browser needs to hand GitHub a pre-filled App: where to POST
 * and the manifest itself. GitHub creates the App when the person clicks
 * "Create", then redirects to /created with a one-time code.
 */
export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  if (!encryptionConfigured()) {
    return NextResponse.json({ error: 'ENCRYPTION_NOT_CONFIGURED' }, { status: 503 });
  }

  const tenant = request.nextUrl.searchParams.get('tenant') ?? '';
  const org = (request.nextUrl.searchParams.get('org') ?? '').trim();
  if (!tenant) return NextResponse.json({ error: 'NO_TENANT' }, { status: 422 });
  if (org && !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(org)) {
    return NextResponse.json({ error: 'BAD_ORG' }, { status: 422 });
  }

  const origin = request.nextUrl.origin;
  const suffix = Math.random().toString(36).slice(2, 6);
  const manifest = {
    name: `AgentSync ${tenant} ${suffix}`.slice(0, 34),
    url: origin,
    redirect_url: `${origin}/api/portal/connections/github/created`,
    setup_url: `${origin}/api/portal/connections/github/installed`,
    setup_on_update: true,
    public: false,
    hook_attributes: { url: `${origin}/api/github/webhook`, active: false },
    default_permissions: {
      contents: 'write',
      pull_requests: 'write',
      checks: 'read',
      actions: 'read',
      metadata: 'read',
    },
    default_events: [],
  };

  const state = signPending({ user_id: user.id, tenant_slug: tenant });
  const base = org
    ? `https://github.com/organizations/${encodeURIComponent(org)}/settings/apps/new`
    : 'https://github.com/settings/apps/new';

  return NextResponse.json(
    { action: `${base}?state=${encodeURIComponent(state)}`, manifest: JSON.stringify(manifest) },
    { headers: { 'cache-control': 'no-store' } },
  );
}
