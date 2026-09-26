import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { kickWorker } from '@/lib/kick';
import { queueMap } from '@/lib/project-maps';
import { serviceClient } from '@/lib/supabase';

// Starting a map runs in the background after the response.
export const maxDuration = 300;

/** POST /api/portal/projects/maps/run-all { tenant_slug } — map every enabled project. */
export async function POST(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const b = (await request.json().catch(() => ({}))) as { tenant_slug?: string };
  const { data } = await serviceClient().rpc('agentsync_portal_configurable_projects', {
    p_user_id: user.id, p_tenant_slug: String(b.tenant_slug ?? ''),
  });
  if (!data) return NextResponse.json({ error: 'NOT_AUTHORISED' }, { status: 403 });
  const projects = data as { id: string }[];
  for (const p of projects) await queueMap(p.id, 'person');
  kickWorker('map');
  return NextResponse.json({ queued: projects.length });
}
