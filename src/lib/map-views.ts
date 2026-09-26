import 'server-only';
import { createHash } from 'node:crypto';
import { serviceClient } from './supabase';

/**
 * Graphify's HTML pages load their drawing libraries from CDNs. The portal
 * serves them as opaque (sandboxed) origins, so each gets its library inline
 * instead: our pinned copy from /public/vendor, checked against its hash
 * before use.
 */

type Library = { tag: RegExp; file: string; sha384: string };

export const VIEWS: Record<string, { stored: string; library: Library | null }> = {
  // Interactive graph: vis-network 9.1.6 from unpkg (Graphify's own SRI hash).
  graph: {
    stored: 'graph.html',
    library: {
      tag: /<script src="https:\/\/unpkg\.com\/vis-network@9\.1\.6\/standalone\/umd\/vis-network\.min\.js"[^>]*><\/script>/,
      file: 'vis-network-9.1.6.min.js',
      sha384: 'Ux6phic9PEHJ38YtrijhkzyJ8yQlH8i/+buBR8s3mAZOJrP1gwyvAcIYl3GWtpX1',
    },
  },
  // File → symbol tree: d3 v7 from d3js.org (7.9.0 is the last v7).
  tree: {
    stored: 'tree.html',
    library: {
      tag: /<script src="https:\/\/d3js\.org\/d3\.v7\.min\.js"[^>]*><\/script>/,
      file: 'd3-7.9.0.min.js',
      sha384: 'CjloA8y00+1SDAUkjs099PVfnY2KmDC2BZnws9kh8D/lX1s46w6EPhpXdqMfjK6i',
    },
  },
  // Architecture / call-flow diagrams: mermaid@11 from jsDelivr, pinned to 11.17.2.
  callflow: {
    stored: 'callflow.html',
    library: {
      tag: /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/mermaid@11\/dist\/mermaid\.min\.js"[^>]*><\/script>/,
      file: 'mermaid-11.17.2.min.js',
      sha384: 'EOXBFmc3gx5mb+vn0vPvvGqACToJD24hhacX5Yx+8NUUQrHIle/Qi5Bg9o3zKwW2',
    },
  },
  svg: { stored: 'graph.svg', library: null },
};

const cache = new Map<string, string>();

async function library(origin: string, lib: Library): Promise<string> {
  const hit = cache.get(lib.file);
  if (hit) return hit;
  const res = await fetch(`${origin}/vendor/${lib.file}`, { cache: 'force-cache' });
  const text = await res.text();
  if (createHash('sha384').update(text).digest('base64') !== lib.sha384) throw new Error(`${lib.file} does not match its pinned hash`);
  cache.set(lib.file, text);
  return text;
}

/** A Graphify page ready for a sandboxed iframe, or null when this map has none. */
export async function renderView(projectId: string, view: string, origin: string, bucket: string): Promise<{ body: string; type: string } | null> {
  const v = VIEWS[view];
  if (!v) return null;
  const { data: file } = await serviceClient().storage.from(bucket).download(`${projectId}/${v.stored}`);
  if (!file) return null;
  const text = await file.text();
  if (!v.library) return { body: text, type: 'image/svg+xml' };
  const lib = await library(origin, v.library);
  // A function replacement: minified libraries contain "$&"-style sequences.
  return { body: text.replace(v.library.tag, () => `<script>${lib}</script>`), type: 'text/html; charset=utf-8' };
}

/** The signed-in user may see this project (in this tenant). */
export async function canSeeProject(userId: string, tenant: string, projectId: string): Promise<boolean> {
  const { data } = await serviceClient().rpc('agentsync_portal_project_access', {
    p_user_id: userId, p_tenant_slug: tenant, p_project_id: projectId,
  });
  return data === true;
}
