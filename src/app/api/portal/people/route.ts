import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { serviceClient } from '@/lib/supabase';

/**
 * GET /api/portal/people?tenant=slug — the names of the people who act on the
 * tenant's tasks (its members, and any admin who has), for showing a person
 * by name instead of their sign-in address.
 */
export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const { data, error } = await serviceClient().rpc('agentsync_portal_people', {
    p_user_id: user.id,
    p_tenant_slug: request.nextUrl.searchParams.get('tenant') ?? '',
  });
  if (error) return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  const result = data as { ok: boolean; error?: string };
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 403 });
  return NextResponse.json(result, { headers: { 'cache-control': 'private, no-store' } });
}
