import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { affected, affectedByFile, explain, findNode, query, shortestPath } from '@/lib/graph-query';
import { canSeeProject } from '@/lib/map-views';
import { loadCodeGraph } from '@/lib/project-maps';

/**
 * POST /api/portal/projects/:id/map/ask — ask the code map, as Graphify's commands do:
 *   { tenant_slug, tool: "query",    question }
 *   { tenant_slug, tool: "explain",  name }
 *   { tenant_slug, tool: "path",     from, to }
 *   { tenant_slug, tool: "affected", name }   (a symbol, or a file path)
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const { id } = await params;
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (!(await canSeeProject(user.id, String(b.tenant_slug ?? ''), id))) {
    return NextResponse.json({ error: 'NOT_AUTHORISED' }, { status: 403 });
  }
  const graph = await loadCodeGraph(id);
  if (!graph) return NextResponse.json({ error: 'NO_MAP', detail: 'This project has no code map yet.' }, { status: 404 });
  const str = (v: unknown) => String(v ?? '').slice(0, 500).trim();

  switch (b.tool) {
    case 'query': {
      const r = query(graph, str(b.question), { depth: 2, budget: 3000 });
      return NextResponse.json({ text: r.text });
    }
    case 'explain': {
      const r = explain(graph, str(b.name));
      return NextResponse.json({ text: r?.text ?? `No node matches "${str(b.name)}".` });
    }
    case 'path':
      return NextResponse.json({ text: shortestPath(graph, str(b.from), str(b.to)).text });
    case 'affected': {
      const name = str(b.name);
      // A path: everything depending on the file. Otherwise one symbol.
      const byFile = /[/.]/.test(name) && !name.endsWith('()') ? affectedByFile(graph, name) : null;
      const seed = byFile?.length ? null : findNode(graph, name);
      const hits = byFile?.length ? byFile : seed ? affected(graph, seed) : [];
      const label = seed ? graph.nodes.get(seed)!.label : name;
      const lines = hits.slice(0, 200).map((h) => `- ${h.node.label} [${h.via}${h.depth > 1 ? `, ${h.depth} steps away` : ''}] ${h.at ?? h.node.source_file ?? '-'}`);
      return NextResponse.json({
        text: hits.length ? `What depends on ${label} (${hits.length}):\n${lines.join('\n')}` : seed || byFile ? `Nothing in the map depends on ${label}.` : `No node matches "${name}".`,
      });
    }
    default:
      return NextResponse.json({ error: 'UNKNOWN_TOOL' }, { status: 422 });
  }
}
