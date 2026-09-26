import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { serviceClient } from '@/lib/supabase';

/** GET /api/portal/tasks/:id/attachments — the documents that came with a task. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const { id } = await params;
  const { data, error } = await serviceClient().rpc('agentsync_portal_task_attachments', {
    p_user_id: user.id,
    p_task_id: id,
  });
  if (error) return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  const list = ((data ?? []) as Record<string, unknown>[]).map(({ storage_path: _p, ...rest }) => {
    void _p;
    return rest;
  });
  return NextResponse.json({ attachments: list }, { headers: { 'cache-control': 'no-store' } });
}
