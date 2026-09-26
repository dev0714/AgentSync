import Anthropic from '@anthropic-ai/sdk';
import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { syncEngineerAgent } from '@/lib/managed-engineer';
import { serviceClient } from '@/lib/supabase';

/**
 * The Engineer as a Claude Managed Agent.
 *
 *   GET  ?tenant=<slug>      what exists in Claude for this tenant's Anthropic key
 *   POST { tenant_slug }     create it in Claude, or publish a new version if its
 *                            prompt changed (no-op when nothing changed)
 */

type Context = {
  can_edit: boolean;
  engineer: { system_prompt: string | null } | null;
  credential_key: string;
  setup: { agent_id: string; agent_version: number; environment_id: string; updated_at: string } | null;
};

async function context(userId: string, tenant: string): Promise<Context | null> {
  const { data, error } = await serviceClient().rpc('agentsync_managed_engineer_context', {
    p_user_id: userId,
    p_tenant_slug: tenant,
  });
  if (error) throw error;
  return data as Context | null;
}

function view(c: Context) {
  return {
    can_edit: c.can_edit,
    credential: c.credential_key.startsWith('env:ANTHROPIC_API_KEY') ? 'platform key' : 'tenant key',
    agent: c.setup
      ? {
          agent_id: c.setup.agent_id,
          version: c.setup.agent_version,
          environment_id: c.setup.environment_id,
          synced_at: c.setup.updated_at,
        }
      : null,
  };
}

export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const c = await context(user.id, request.nextUrl.searchParams.get('tenant') ?? '');
  if (!c) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  return NextResponse.json(view(c), { headers: { 'cache-control': 'no-store' } });
}

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'BAD_JSON' }, { status: 400 });
  }
  const tenant = String(b.tenant_slug ?? '');
  const c = await context(user.id, tenant);
  if (!c) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  if (!c.can_edit) return NextResponse.json({ error: 'NOT_AUTHORISED' }, { status: 403 });
  if (!c.engineer) return NextResponse.json({ error: 'NO_ENGINEER_DEFINITION' }, { status: 422 });

  try {
    const result = await syncEngineerAgent(c.credential_key, c.engineer);
    const fresh = await context(user.id, tenant);
    return NextResponse.json({ action: result.action, ...(fresh ? view(fresh) : {}) });
  } catch (e) {
    console.error('syncing the Engineer to Claude failed', e);
    const detail =
      e instanceof Anthropic.AuthenticationError
        ? 'The Anthropic key was rejected. Check ANTHROPIC_API_KEY in Vercel.'
        : e instanceof Anthropic.PermissionDeniedError
          ? 'This Anthropic key does not have access to Managed Agents.'
          : e instanceof Error
            ? e.message
            : 'unknown error';
    return NextResponse.json({ error: 'SYNC_FAILED', detail }, { status: 502 });
  }
}
