import { NextResponse, type NextRequest } from 'next/server';
import { open } from '@/lib/crypto';
import { resolveSecret } from '@/lib/secrets';
import { sha256b64url } from '@/lib/source-connect';
import { serviceClient } from '@/lib/supabase';

/**
 * POST /api/v1/connect/exchange — a source's server trades the one-time code
 * from the one-click connection for its credentials.
 *
 *   { "code": "…", "verifier": "…" }
 *   → { "api_key": "ask_live_…", "callback_secret": "whsec_…", "source_id": "…", "tenant_name": "…" }
 *
 * The code works once, within 10 minutes, and only with the verifier whose
 * SHA-256 was sent as the challenge — so a code seen in a browser is useless.
 */
export async function POST(request: NextRequest) {
  let b: { code?: unknown; verifier?: unknown };
  try {
    b = (await request.json()) as typeof b;
  } catch {
    return NextResponse.json({ error: 'BAD_JSON' }, { status: 400 });
  }
  const code = typeof b.code === 'string' ? b.code : '';
  const verifier = typeof b.verifier === 'string' ? b.verifier : '';
  if (!code || verifier.length < 43 || verifier.length > 128) {
    return NextResponse.json({ error: 'INVALID_CODE' }, { status: 400 });
  }

  const db = serviceClient();
  const codeHash = sha256b64url(code);
  const { data, error } = await db.rpc('agentsync_connect_code_take', {
    p_code_hash: codeHash,
    p_challenge: sha256b64url(verifier),
  });
  const row = data as {
    ok: boolean; source_system_id?: string; ciphertext?: string; iv?: string; tag?: string;
    callback_secret_ref?: string; tenant_name?: string; tenant_slug?: string;
  } | null;
  if (error || !row?.ok) return NextResponse.json({ error: 'INVALID_CODE' }, { status: 400 });

  try {
    const apiKey = open({ ciphertext: row.ciphertext!, iv: row.iv!, tag: row.tag! });
    const callbackSecret = await resolveSecret(row.callback_secret_ref);
    await db.rpc('agentsync_connect_code_wipe', { p_code_hash: codeHash });
    return NextResponse.json(
      {
        api_key: apiKey,
        callback_secret: callbackSecret,
        source_id: row.source_system_id,
        tenant_name: row.tenant_name,
        tenant_slug: row.tenant_slug,
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (e) {
    console.error('connect exchange failed', e);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
