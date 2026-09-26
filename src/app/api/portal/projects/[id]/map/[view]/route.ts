import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { canSeeProject, renderView, VIEWS } from '@/lib/map-views';
import { MAP_BUCKET } from '@/lib/project-maps';

/**
 * GET /api/portal/projects/:id/map/:view?tenant=slug — one of Graphify's pages
 * for an iframe: graph (interactive map), tree (file tree), callflow (call-flow
 * diagrams); or svg (a picture of the graph).
 *
 * Pages are served under a sandbox CSP: scripts run, but as an opaque origin —
 * no cookies, no access to the portal. The picture runs no scripts at all.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; view: string }> }) {
  const user = await currentUser();
  if (!user) return new NextResponse('Sign in to AgentSync to see this map.', { status: 401 });
  const { id, view } = await params;
  if (!VIEWS[view]) return new NextResponse('No such view.', { status: 404 });
  if (!(await canSeeProject(user.id, request.nextUrl.searchParams.get('tenant') ?? '', id))) {
    return new NextResponse('Not allowed.', { status: 403 });
  }
  const page = await renderView(id, view, request.nextUrl.origin, MAP_BUCKET);
  if (!page) return new NextResponse('This map has no such view yet. Map the project again to make it.', { status: 404 });
  const download = request.nextUrl.searchParams.get('download') === '1';
  return new NextResponse(page.body, {
    headers: {
      'content-type': page.type,
      'content-security-policy': view === 'svg' ? "default-src 'none'; style-src 'unsafe-inline'; sandbox" : 'sandbox allow-scripts allow-popups',
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
      ...(download ? { 'content-disposition': `attachment; filename="code-map${view === 'svg' ? '.svg' : `-${view}.html`}"` } : {}),
    },
  });
}
