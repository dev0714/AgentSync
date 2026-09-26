import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { seal } from './crypto';
import { serviceClient } from './supabase';

/**
 * Generates a new callback secret for a source, stores it encrypted and points
 * the source at it (revoking the old one). Returns the secret in plain text —
 * the caller shows it once or hands it to the source, and never stores it.
 */
export async function newCallbackSecret(
  userId: string,
  tenantSlug: string,
  sourceId: string,
): Promise<{ ok: true; secret: string; reference: string } | { ok: false; error: string }> {
  const secret = `whsec_${randomBytes(32).toString('base64url')}`;
  const sealed = seal(secret);
  const db = serviceClient();

  const { data: stored, error: storeError } = await db.rpc('agentsync_store_secret', {
    p_user_id: userId,
    p_tenant_slug: tenantSlug,
    p_purpose: `source_callback:${sourceId}`,
    p_ciphertext: sealed.ciphertext,
    p_iv: sealed.iv,
    p_tag: sealed.tag,
  });
  const s = stored as { ok: boolean; reference?: string; error?: string } | null;
  if (storeError || !s?.ok || !s.reference) return { ok: false, error: s?.error ?? 'INTERNAL_ERROR' };

  const { data, error } = await db.rpc('agentsync_portal_set_source_callback_secret', {
    p_user_id: userId,
    p_tenant_slug: tenantSlug,
    p_source_id: sourceId,
    p_reference: s.reference,
  });
  const r = data as { ok: boolean; error?: string } | null;
  if (error || !r?.ok) return { ok: false, error: r?.error ?? 'INTERNAL_ERROR' };
  return { ok: true, secret, reference: s.reference };
}

export function sha256b64url(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

/** The return address a source asked for: https only (http for localhost in development). */
export function safeReturnUrl(raw: string | null | undefined): URL | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol === 'https:' || (local && url.protocol === 'http:' && process.env.NODE_ENV !== 'production')) {
      url.hash = '';
      return url;
    }
  } catch {
    // not a URL
  }
  return null;
}
