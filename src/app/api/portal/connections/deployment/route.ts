import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { connectDeployment, disconnectDeployment } from '@/lib/connections';

/**
 * POST|DELETE /api/portal/connections/deployment
 *
 * Records or removes the tenant's deployment provider. Same shape as the
 * GitHub route: the caller comes from the session cookie, and the database
 * function re-checks that they may configure this tenant.
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
  const result = await connectDeployment(user.id, {
    tenantSlug: String(b.tenant_slug ?? ''),
    provider: String(b.provider ?? ''),
    teamId: String(b.team_id ?? ''),
    apiTokenReference: String(b.api_token_reference ?? ''),
    tokenScope: String(b.token_scope ?? ''),
    previewOn: String(b.preview_on ?? 'pull_request'),
    productionTrigger: String(b.production_trigger ?? 'merge'),
    promoteViaApi: Boolean(b.promote_via_api),
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

  const result = await disconnectDeployment(user.id, slug);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: STATUS[result.error] ?? 422 },
    );
  }
  return NextResponse.json({ ok: true });
}
