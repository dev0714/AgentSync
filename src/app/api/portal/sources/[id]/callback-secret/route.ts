import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { encryptionConfigured } from '@/lib/crypto';
import { newCallbackSecret } from '@/lib/source-connect';

/**
 * POST /api/portal/sources/:id/callback-secret — generate the secret that
 * signs callbacks to this source (x-agentsync-signature: sha256=HMAC(body)).
 *
 * The secret is in this response and nowhere else in plain text: it is stored
 * encrypted, and generating a new one revokes the old.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const { id } = await params;

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'BAD_JSON' }, { status: 400 });
  }
  const tenantSlug = String(b.tenant_slug ?? '');

  if (!encryptionConfigured()) {
    return NextResponse.json(
      { error: 'ENCRYPTION_NOT_CONFIGURED', detail: 'Set AGENTSYNC_ENCRYPTION_KEY in Vercel first.' },
      { status: 503 },
    );
  }

  const result = await newCallbackSecret(user.id, tenantSlug, id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.error === 'NOT_AUTHORISED' ? 403 : 500 });
  }
  const { secret } = result;
  return NextResponse.json({ ok: true, secret }, { headers: { 'cache-control': 'no-store' } });
}
