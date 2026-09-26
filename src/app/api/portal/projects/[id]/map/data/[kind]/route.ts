import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { canSeeProject } from '@/lib/map-views';
import { projectHubs, readMapFile } from '@/lib/project-maps';

/**
 * GET /api/portal/projects/:id/map/data/:kind?tenant=slug
 *   hubs    — the most-connected code (graphify god-nodes)
 *   lessons — LESSONS.md (graphify reflect over past tasks)
 *   wiki    — { "index.md": "...", "<article>.md": "..." } (graphify export wiki)
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; kind: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const { id, kind } = await params;
  if (!(await canSeeProject(user.id, request.nextUrl.searchParams.get('tenant') ?? '', id))) {
    return NextResponse.json({ error: 'NOT_AUTHORISED' }, { status: 403 });
  }
  const headers = { 'cache-control': 'private, no-store' };
  if (kind === 'hubs') return NextResponse.json({ hubs: await projectHubs(id) }, { headers });
  if (kind === 'lessons') {
    const file = await readMapFile(id, 'LESSONS.md');
    return NextResponse.json({ lessons: file?.toString('utf8') ?? null }, { headers });
  }
  if (kind === 'wiki') {
    const file = await readMapFile(id, 'wiki.json');
    let wiki: Record<string, string> | null = null;
    try {
      wiki = file ? (JSON.parse(file.toString('utf8')) as Record<string, string>) : null;
    } catch {
      wiki = null;
    }
    return NextResponse.json({ wiki }, { headers });
  }
  return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
}
