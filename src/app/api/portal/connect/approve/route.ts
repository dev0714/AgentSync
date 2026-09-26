import { randomBytes } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { encryptionConfigured, seal } from '@/lib/crypto';
import { newCallbackSecret, safeReturnUrl, sha256b64url } from '@/lib/source-connect';
import { serviceClient } from '@/lib/supabase';

/**
 * POST /api/portal/connect/approve — the person approved a source's one-click
 * connection on /connect.
 *
 *   { tenant_slug, app, account, return_url, state, challenge }
 *
 * Finds or creates the source (reconnecting rotates its key and keeps its
 * client mappings), generates a callback secret, seals the key behind a
 * one-time code and answers with the URL to send the browser back to. The
 * source exchanges the code, with its verifier, at /api/v1/connect/exchange.
 */
export async function POST(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'BAD_JSON' }, { status: 400 });
  }
  const tenantSlug = String(b.tenant_slug ?? '');
  const app = String(b.app ?? '').trim().slice(0, 40);
  const account = String(b.account ?? '').trim().slice(0, 70);
  const state = String(b.state ?? '');
  const challenge = String(b.challenge ?? '');
  const returnUrl = safeReturnUrl(String(b.return_url ?? ''));

  if (!app || !returnUrl || !/^[A-Za-z0-9_-]{16,200}$/.test(state) || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 });
  }
  if (!encryptionConfigured()) {
    return NextResponse.json({ error: 'ENCRYPTION_NOT_CONFIGURED' }, { status: 503 });
  }

  const db = serviceClient();
  const name = account ? `${app} · ${account}` : app;
  const { data, error } = await db.rpc('agentsync_portal_connect_source', {
    p_user_id: user.id,
    p_tenant_slug: tenantSlug,
    p_name: name,
  });
  const source = data as { ok: boolean; error?: string; source_system_id?: string; api_key?: string } | null;
  if (error || !source?.ok || !source.source_system_id || !source.api_key) {
    return NextResponse.json({ error: source?.error ?? 'INTERNAL_ERROR' }, { status: source?.error === 'NOT_AUTHORISED' ? 403 : 500 });
  }

  const callback = await newCallbackSecret(user.id, tenantSlug, source.source_system_id);
  if (!callback.ok) return NextResponse.json({ error: callback.error }, { status: 500 });

  const code = randomBytes(32).toString('base64url');
  const sealed = seal(source.api_key);
  const { data: put, error: putError } = await db.rpc('agentsync_connect_code_put', {
    p_user_id: user.id,
    p_source_id: source.source_system_id,
    p_code_hash: sha256b64url(code),
    p_challenge: challenge,
    p_ciphertext: sealed.ciphertext,
    p_iv: sealed.iv,
    p_tag: sealed.tag,
    p_callback_secret_ref: callback.reference,
  });
  if (putError || !(put as { ok?: boolean } | null)?.ok) {
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }

  returnUrl.searchParams.set('code', code);
  returnUrl.searchParams.set('state', state);
  return NextResponse.json({ redirect: returnUrl.toString() }, { headers: { 'cache-control': 'no-store' } });
}
