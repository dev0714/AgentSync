import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { serviceClient } from '@/lib/supabase';

/**
 * POST /api/portal/sources — issue a key for a system that submits tasks.
 *
 * The plaintext key is in this response and nowhere else: only its hash is
 * stored, so it cannot be shown again.
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

  const { data, error } = await serviceClient().rpc('agentsync_portal_issue_source_key', {
    p_user_id: user.id,
    p_tenant_slug: String(b.tenant_slug ?? ''),
    p_name: String(b.name ?? ''),
  });
  if (error) {
    console.error('issue source key failed', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
  const result = data as { ok: boolean; error?: string; api_key?: string };
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.error === 'NOT_AUTHORISED' ? 403 : 422 });
  }
  return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
}
