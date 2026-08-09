import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { deleteWebhookEndpoint, upsertWebhookEndpoint } from '@/lib/connections';

/** POST|DELETE /api/portal/connections/webhooks — one endpoint per path. */

const STATUS: Record<string, number> = { NOT_AUTHORISED: 403, NO_SUCH_TENANT: 404 };

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
  const result = await upsertWebhookEndpoint(user.id, {
    tenantSlug: String(b.tenant_slug ?? ''),
    direction: String(b.direction ?? ''),
    path: String(b.path ?? ''),
    note: String(b.note ?? ''),
    signingSecretRef: String(b.signing_secret_ref ?? ''),
    replayWindowSeconds: Number(b.replay_window_seconds ?? 300),
    enabled: b.enabled !== false,
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

  const tenant = request.nextUrl.searchParams.get('tenant');
  const path = request.nextUrl.searchParams.get('path');
  if (!tenant || !path) {
    return NextResponse.json({ error: 'NO_SUCH_TENANT' }, { status: 404 });
  }

  const result = await deleteWebhookEndpoint(user.id, tenant, path);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: STATUS[result.error] ?? 422 });
  }
  return NextResponse.json({ ok: true });
}
