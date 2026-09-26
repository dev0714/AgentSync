import { NextResponse, type NextRequest } from 'next/server';
import { BUCKET } from '@/lib/attachments';
import { currentUser } from '@/lib/auth';
import { serviceClient } from '@/lib/supabase';

/**
 * GET /api/portal/tasks/:id/attachments/:aid — download the original.
 * Checks the viewer belongs to the task's tenant, then redirects to a signed
 * link that expires in a minute.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; aid: string }> },
) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL('/login', request.url));
  const { id, aid } = await params;
  const { data } = await serviceClient().rpc('agentsync_portal_task_attachments', {
    p_user_id: user.id,
    p_task_id: id,
  });
  const file = ((data ?? []) as { id: string; storage_path: string; filename: string }[]).find((a) => a.id === aid);
  if (!file) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  const { data: signed, error } = await serviceClient()
    .storage.from(BUCKET)
    .createSignedUrl(file.storage_path, 60, { download: file.filename });
  if (error || !signed) return NextResponse.json({ error: 'NOT_STORED' }, { status: 404 });
  return NextResponse.redirect(signed.signedUrl);
}
