import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { serviceClient } from '@/lib/supabase';

/**
 * Low / Medium / High model tiers.
 *
 *   GET    ?tenant=<slug>                         every agent's three slots + each project's default tier
 *   PUT    { tenant_slug, agent_key, tier, model, effort }   override one slot for the tenant
 *   DELETE { tenant_slug, agent_key, tier }                  back to the platform default
 *   POST   { project_id, tier }                              set a project's default tier
 *   POST   { project_id, engineer_mode }                     'sandbox' or 'direct' Engineer
 *
 * The database re-checks that the session user may configure the tenant.
 */

const STATUS: Record<string, number> = { NOT_AUTHORISED: 403 };

async function body(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function reply(data: unknown, error: unknown) {
  if (error) {
    console.error('tier settings failed', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
  const r = data as { ok: boolean; error?: string };
  return r.ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: r.error }, { status: STATUS[r.error ?? ''] ?? 422 });
}

export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const { data, error } = await serviceClient().rpc('agentsync_tier_settings', {
    p_user_id: user.id,
    p_tenant_slug: request.nextUrl.searchParams.get('tenant') ?? '',
  });
  if (error) return reply(null, error);
  if (!data) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  return NextResponse.json(data, { headers: { 'cache-control': 'no-store' } });
}

export async function PUT(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const b = await body(request);
  if (!b) return NextResponse.json({ error: 'BAD_JSON' }, { status: 400 });
  const { data, error } = await serviceClient().rpc('agentsync_set_tier_model', {
    p_user_id: user.id,
    p_tenant_slug: String(b.tenant_slug ?? ''),
    p_agent_key: String(b.agent_key ?? ''),
    p_tier: String(b.tier ?? ''),
    p_model: String(b.model ?? ''),
    p_effort: typeof b.effort === 'string' ? b.effort : null,
  });
  return reply(data, error);
}

export async function DELETE(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const b = await body(request);
  if (!b) return NextResponse.json({ error: 'BAD_JSON' }, { status: 400 });
  const { data, error } = await serviceClient().rpc('agentsync_reset_tier_model', {
    p_user_id: user.id,
    p_tenant_slug: String(b.tenant_slug ?? ''),
    p_agent_key: String(b.agent_key ?? ''),
    p_tier: String(b.tier ?? ''),
  });
  return reply(data, error);
}

export async function POST(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const b = await body(request);
  if (!b) return NextResponse.json({ error: 'BAD_JSON' }, { status: 400 });
  if (typeof b.engineer_mode === 'string') {
    const { data, error } = await serviceClient().rpc('agentsync_set_project_engineer_mode', {
      p_user_id: user.id,
      p_project_id: String(b.project_id ?? ''),
      p_mode: b.engineer_mode,
    });
    return reply(data, error);
  }
  const { data, error } = await serviceClient().rpc('agentsync_set_project_tier', {
    p_user_id: user.id,
    p_project_id: String(b.project_id ?? ''),
    p_tier: String(b.tier ?? ''),
  });
  return reply(data, error);
}
