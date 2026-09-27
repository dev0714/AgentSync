import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { seal } from '@/lib/crypto';
import { resolveSecret } from '@/lib/secrets';
import { inspectToken } from '@/lib/supabase-mgmt';
import { serviceClient } from '@/lib/supabase';

/**
 * /api/portal/connections/supabase — the tenant's Supabase connection.
 *
 *   GET    ?tenant=<slug>                         the connection (reference, organisation, projects)
 *   POST   { tenant_slug, token }                 connect with a pasted access token (stored encrypted)
 *   POST   { tenant_slug, token_reference }       connect with a reference (env:NAME)
 *   POST   { tenant_slug, refresh: true }         re-read the project list with the stored token
 *   DELETE { tenant_slug }                        disconnect (a stored token is revoked)
 *
 * The token is checked against Supabase before anything is saved; the
 * database functions re-check that the caller may configure the tenant.
 */

const STATUS: Record<string, number> = { NOT_AUTHORISED: 403, NO_SUCH_TENANT: 404 };

export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const tenant = request.nextUrl.searchParams.get('tenant') ?? '';
  const { data, error } = await serviceClient().rpc('agentsync_supabase_connection', { p_user_id: user.id, p_tenant_slug: tenant });
  if (error) return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  const r = data as { ok: boolean; error?: string };
  return NextResponse.json(r, { status: r.ok ? 200 : STATUS[r.error ?? ''] ?? 422 });
}

export async function POST(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const b = (await request.json().catch(() => ({}))) as { tenant_slug?: string; token?: string; token_reference?: string; refresh?: boolean };
  const tenantSlug = String(b.tenant_slug ?? '');
  const db = serviceClient();

  // Which token: pasted now, a reference, or the one already stored.
  let token: string;
  let reference: string | null = null;
  try {
    if (b.token?.trim()) {
      token = b.token.trim();
    } else if (b.token_reference?.trim()) {
      reference = b.token_reference.trim();
      token = await resolveSecret(reference);
    } else if (b.refresh) {
      const { data } = await db.rpc('agentsync_supabase_connection', { p_user_id: user.id, p_tenant_slug: tenantSlug });
      reference = ((data as { connection?: { token_reference?: string } | null })?.connection?.token_reference) ?? null;
      if (!reference) return NextResponse.json({ error: 'NOT_CONNECTED' }, { status: 409 });
      token = await resolveSecret(reference);
    } else {
      return NextResponse.json({ error: 'TOKEN_REQUIRED' }, { status: 422 });
    }
  } catch (e) {
    return NextResponse.json({ error: 'SECRET_UNAVAILABLE', detail: (e as Error).message }, { status: 422 });
  }

  let seen: Awaited<ReturnType<typeof inspectToken>>;
  try {
    seen = await inspectToken(token);
  } catch (e) {
    return NextResponse.json({ error: 'TOKEN_REFUSED', detail: (e as Error).message }, { status: 422 });
  }

  // A pasted token is sealed and stored; the connection keeps only db:<id>.
  if (!reference) {
    const sealed = seal(token);
    const { data: stored, error: storeError } = await db.rpc('agentsync_store_secret', {
      p_user_id: user.id,
      p_tenant_slug: tenantSlug,
      p_purpose: 'supabase_access_token',
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

  const { data, error } = await db.rpc('agentsync_connect_supabase', {
    p_user_id: user.id,
    p_tenant_slug: tenantSlug,
    p_token_reference: reference,
    p_organization: seen.organizations.join(', ') || null,
    p_projects: seen.projects,
  });
  if (error) return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  const r = data as { ok: boolean; error?: string };
  if (!r.ok) return NextResponse.json(r, { status: STATUS[r.error ?? ''] ?? 422 });
  return NextResponse.json({ ok: true, projects: seen.projects.length, organizations: seen.organizations });
}

export async function DELETE(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const b = (await request.json().catch(() => ({}))) as { tenant_slug?: string };
  const { data, error } = await serviceClient().rpc('agentsync_disconnect_supabase', {
    p_user_id: user.id,
    p_tenant_slug: String(b.tenant_slug ?? ''),
  });
  if (error) return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  const r = data as { ok: boolean; error?: string };
  return NextResponse.json(r, { status: r.ok ? 200 : STATUS[r.error ?? ''] ?? 422 });
}
