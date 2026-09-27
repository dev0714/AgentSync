import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { connectDeployment, disconnectDeployment } from '@/lib/connections';
import { seal } from '@/lib/crypto';
import { serviceClient } from '@/lib/supabase';
import { inspectVercelToken } from '@/lib/vercel';

/**
 * POST|DELETE /api/portal/connections/deployment
 *
 * Records or removes the tenant's deployment provider. Same shape as the
 * GitHub route: the caller comes from the session cookie, and the database
 * function re-checks that they may configure this tenant.
 *
 * A Vercel token may be pasted (`api_token`): it is checked with Vercel,
 * stored encrypted, and the connection keeps only its reference (db:…).
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
  let reference = String(b.api_token_reference ?? '');
  const pasted = typeof b.api_token === 'string' ? b.api_token.trim() : '';
  if (pasted) {
    if (String(b.provider ?? '') !== 'vercel') {
      return NextResponse.json({ error: 'UNSUPPORTED_PROVIDER', detail: 'A pasted token works for Vercel; give a reference for other providers.' }, { status: 422 });
    }
    try {
      await inspectVercelToken(pasted);
    } catch (e) {
      return NextResponse.json({ error: 'TOKEN_REFUSED', detail: (e as Error).message }, { status: 422 });
    }
    const sealed = seal(pasted);
    const { data: stored, error: storeError } = await serviceClient().rpc('agentsync_store_secret', {
      p_user_id: user.id,
      p_tenant_slug: String(b.tenant_slug ?? ''),
      p_purpose: 'vercel_api_token',
      p_ciphertext: sealed.ciphertext,
      p_iv: sealed.iv,
      p_tag: sealed.tag,
    });
    const s = stored as { ok: boolean; reference?: string; error?: string } | null;
    if (storeError || !s?.ok || !s.reference) {
      return NextResponse.json({ error: s?.error ?? 'INTERNAL_ERROR' }, { status: STATUS[s?.error ?? ''] ?? 500 });
    }
    reference = s.reference;
  }

  const result = await connectDeployment(user.id, {
    tenantSlug: String(b.tenant_slug ?? ''),
    provider: String(b.provider ?? ''),
    teamId: String(b.team_id ?? ''),
    apiTokenReference: reference,
    tokenScope: String(b.token_scope ?? '').trim() || (pasted ? 'Read deployments' : ''),
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
