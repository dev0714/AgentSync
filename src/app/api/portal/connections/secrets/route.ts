import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { deleteSecretReference, upsertSecretReference } from '@/lib/connections';

/** POST|DELETE /api/portal/connections/secrets — one row per reference. */

const STATUS: Record<string, number> = {
  NOT_AUTHORISED: 403,
  NO_SUCH_TENANT: 404,
  REFERENCE_IN_USE: 409,
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
  const result = await upsertSecretReference(user.id, {
    tenantSlug: String(b.tenant_slug ?? ''),
    reference: String(b.reference ?? ''),
    usedBy: String(b.used_by ?? ''),
    rotationDays: Number(b.rotation_days ?? 90),
    revoked: Boolean(b.revoked),
    markRotated: Boolean(b.mark_rotated),
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
  const reference = request.nextUrl.searchParams.get('reference');
  if (!tenant || !reference) {
    return NextResponse.json({ error: 'NO_SUCH_TENANT' }, { status: 404 });
  }

  const result = await deleteSecretReference(user.id, tenant, reference);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: STATUS[result.error] ?? 422 });
  }
  return NextResponse.json({ ok: true });
}
