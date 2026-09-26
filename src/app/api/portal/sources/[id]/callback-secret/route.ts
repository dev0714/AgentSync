import { randomBytes } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { encryptionConfigured, seal } from '@/lib/crypto';
import { serviceClient } from '@/lib/supabase';

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

  const secret = `whsec_${randomBytes(32).toString('base64url')}`;
  const sealed = seal(secret);
  const db = serviceClient();
  const { data: stored, error: storeError } = await db.rpc('agentsync_store_secret', {
    p_user_id: user.id,
    p_tenant_slug: tenantSlug,
    p_purpose: `source_callback:${id}`,
    p_ciphertext: sealed.ciphertext,
    p_iv: sealed.iv,
    p_tag: sealed.tag,
  });
  const s = stored as { ok: boolean; reference?: string; error?: string } | null;
  if (storeError || !s?.ok || !s.reference) {
    return NextResponse.json({ error: s?.error ?? 'INTERNAL_ERROR' }, { status: s?.error === 'NOT_AUTHORISED' ? 403 : 500 });
  }

  const { data, error } = await db.rpc('agentsync_portal_set_source_callback_secret', {
    p_user_id: user.id,
    p_tenant_slug: tenantSlug,
    p_source_id: id,
    p_reference: s.reference,
  });
  const r = data as { ok: boolean; error?: string } | null;
  if (error || !r?.ok) {
    return NextResponse.json({ error: r?.error ?? 'INTERNAL_ERROR' }, { status: r?.error === 'NOT_AUTHORISED' ? 403 : 500 });
  }
  return NextResponse.json({ ok: true, secret }, { headers: { 'cache-control': 'no-store' } });
}
