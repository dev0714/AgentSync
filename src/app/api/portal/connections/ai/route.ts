import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { deleteAiCredential, upsertAiCredential } from '@/lib/connections';

/** POST|DELETE /api/portal/connections/ai — one credential per provider. */

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
  const cap = b.monthly_cap;
  const result = await upsertAiCredential(user.id, {
    tenantSlug: String(b.tenant_slug ?? ''),
    provider: String(b.provider ?? ''),
    model: String(b.model ?? ''),
    keyReference: String(b.key_reference ?? ''),
    failoverTriggers: String(b.failover_triggers ?? ''),
    failoverRequiresOptin: b.failover_requires_optin !== false,
    monthlyCap: cap === null || cap === undefined || cap === '' ? null : Number(cap),
    hardStopAtCap: b.hard_stop_at_cap !== false,
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
  const provider = request.nextUrl.searchParams.get('provider');
  if (!tenant || !provider) {
    return NextResponse.json({ error: 'NO_SUCH_TENANT' }, { status: 404 });
  }

  const result = await deleteAiCredential(user.id, tenant, provider);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: STATUS[result.error] ?? 422 });
  }
  return NextResponse.json({ ok: true });
}
