import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { MAP_BUCKET } from '@/lib/project-maps';
import { createHash } from 'node:crypto';
import { serviceClient } from '@/lib/supabase';

const VIS_TAG = /<script src="https:\/\/unpkg\.com\/vis-network@9\.1\.6\/standalone\/umd\/vis-network\.min\.js"[^>]*><\/script>/;
const VIS_SHA384 = 'Ux6phic9PEHJ38YtrijhkzyJ8yQlH8i/+buBR8s3mAZOJrP1gwyvAcIYl3GWtpX1';
let visCache: string | null = null;

async function visNetwork(origin: string): Promise<string> {
  if (visCache) return visCache;
  const res = await fetch(`${origin}/vendor/vis-network-9.1.6.min.js`, { cache: 'force-cache' });
  const text = await res.text();
  if (createHash('sha384').update(text).digest('base64') !== VIS_SHA384) throw new Error('vis-network copy does not match its pinned hash');
  visCache = text;
  return text;
}

/**
 * GET /api/portal/projects/:id/map/graph?tenant=slug — Graphify's interactive
 * graph.html, for an iframe. It is served under a sandbox CSP (scripts run, but
 * as an opaque origin: no cookies, no access to the portal).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new NextResponse('Sign in to AgentSync to see this map.', { status: 401 });
  const { id } = await params;
  const { data: ok } = await serviceClient().rpc('agentsync_portal_project_access', {
    p_user_id: user.id, p_tenant_slug: request.nextUrl.searchParams.get('tenant') ?? '', p_project_id: id,
  });
  if (ok !== true) return new NextResponse('Not allowed.', { status: 403 });

  const { data: file } = await serviceClient().storage.from(MAP_BUCKET).download(`${id}/graph.html`);
  if (!file) return new NextResponse('This project has no interactive map yet.', { status: 404 });
  // Graphify's page draws with vis-network 9.1.6 from unpkg. The page runs as
  // an opaque (sandboxed) origin, so it gets the library inline: our pinned
  // copy, checked against the same integrity hash Graphify's page declares.
  const vis = await visNetwork(request.nextUrl.origin);
  // A function replacement: the minified library contains "$&"-style sequences.
  const html = (await file.text()).replace(VIS_TAG, () => `<script>${vis}</script>`);
  return new NextResponse(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': 'sandbox allow-scripts allow-popups',
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
    },
  });
}
