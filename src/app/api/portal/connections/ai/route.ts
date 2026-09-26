import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { deleteAiCredential, upsertAiCredential } from '@/lib/connections';
import { encryptionConfigured, seal } from '@/lib/crypto';
import { serviceClient } from '@/lib/supabase';

/** A stored reference (env:NAME, db:<id>) as opposed to a pasted key. */
const REFERENCE = /^[a-z][a-z0-9+.-]*:\S+$/;

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
  const tenantSlug = String(b.tenant_slug ?? '');
  let keyReference = String(b.key_reference ?? '').trim();

  // A pasted key is never stored as given: it is encrypted with the
  // deployment's key and the credential holds only a db:<id> reference.
  if (keyReference && !REFERENCE.test(keyReference)) {
    if (!encryptionConfigured()) {
      return NextResponse.json(
        { error: 'ENCRYPTION_NOT_CONFIGURED', detail: 'Set AGENTSYNC_ENCRYPTION_KEY in Vercel, or enter env:ANTHROPIC_API_KEY instead.' },
        { status: 503 },
      );
    }
    const sealed = seal(keyReference);
    const { data, error } = await serviceClient().rpc('agentsync_store_secret', {
      p_user_id: user.id,
      p_tenant_slug: tenantSlug,
      p_purpose: `ai_key:${String(b.provider ?? '')}`,
      p_ciphertext: sealed.ciphertext,
      p_iv: sealed.iv,
      p_tag: sealed.tag,
    });
    const stored = data as { ok: boolean; reference?: string; error?: string } | null;
    if (error || !stored?.ok || !stored.reference) {
      return NextResponse.json(
        { error: stored?.error ?? 'INTERNAL_ERROR' },
        { status: stored?.error === 'NOT_AUTHORISED' ? 403 : 500 },
      );
    }
    keyReference = stored.reference;
  }
  const result = await upsertAiCredential(user.id, {
    tenantSlug,
    provider: String(b.provider ?? ''),
    model: String(b.model ?? ''),
    keyReference,
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
