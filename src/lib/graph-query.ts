/**
 * Questions answered from a project's code map (Graphify's graph.json), for the
 * agents and the Map tab. These mirror Graphify's own commands, which run in
 * Python and so can't run here:
 *
 *   query     — `graphify query`: the part of the graph a question is about
 *   affected  — `graphify affected`: what depends on a symbol or file
 *   path      — `graphify path`: how two things connect
 *   explain   — `graphify explain`: one node and its connections
 *
 * The scoring, seeding, traversal and output format follow graphifyy 0.9.69
 * (serve.py, affected.py), trimmed to what code-only maps contain.
 */

export type GraphNode = {
  id: string;
  label: string;
  source_file?: string | null;
  source_location?: string | null;
  community?: number | null;
  community_name?: string | null;
  norm_label?: string | null;
};

export type GraphEdge = {
  source: string;
  target: string;
  relation: string;
  confidence?: string | null;
  context?: string | null;
  source_file?: string | null;
  source_location?: string | null;
};

type RawGraph = { nodes?: Record<string, unknown>[]; links?: Record<string, unknown>[]; edges?: Record<string, unknown>[] };

export class CodeGraph {
  readonly nodes = new Map<string, GraphNode>();
  readonly out = new Map<string, GraphEdge[]>();
  readonly in = new Map<string, GraphEdge[]>();
  private hub: number | null = null;
  private idf = new Map<string, number>();

  constructor(raw: RawGraph) {
    for (const n of raw.nodes ?? []) {
      const id = String(n.id ?? '');
      if (!id) continue;
      this.nodes.set(id, {
        id,
        label: String(n.label ?? id),
        source_file: (n.source_file as string) ?? null,
        source_location: (n.source_location as string) ?? null,
        community: (n.community as number) ?? null,
        community_name: (n.community_name as string) ?? null,
        norm_label: (n.norm_label as string) ?? null,
      });
    }
    for (const e of raw.links ?? raw.edges ?? []) {
      const id = (v: unknown) => String(typeof v === 'object' && v !== null ? (v as { id?: unknown }).id : v);
      // Graphify keeps the true direction in _src/_tgt when storage flipped it.
      const source = id(e._src ?? e.source);
      const target = id(e._tgt ?? e.target);
      if (!this.nodes.has(source) || !this.nodes.has(target)) continue;
      const edge: GraphEdge = {
        source,
        target,
        relation: String(e.relation ?? ''),
        confidence: (e.confidence as string) ?? null,
        context: (e.context as string) ?? null,
        source_file: (e.source_file as string) ?? null,
        source_location: (e.source_location as string) ?? null,
      };
      push(this.out, source, edge);
      push(this.in, target, edge);
    }
  }

  static parse(text: string): CodeGraph {
    return new CodeGraph(JSON.parse(text) as RawGraph);
  }

  degree(id: string): number {
    return (this.out.get(id)?.length ?? 0) + (this.in.get(id)?.length ?? 0);
  }

  neighbours(id: string): string[] {
    const seen = new Set<string>();
    for (const e of this.out.get(id) ?? []) seen.add(e.target);
    for (const e of this.in.get(id) ?? []) seen.add(e.source);
    seen.delete(id);
    return [...seen];
  }

  /** p99 of the degree distribution, floored at 50: hubs aren't walked through. */
  hubThreshold(): number {
    if (this.hub !== null) return this.hub;
    const d = [...this.nodes.keys()].map((n) => this.degree(n)).sort((a, b) => a - b);
    this.hub = d.length ? Math.max(50, d[Math.floor(d.length * 0.99)] ?? 50) : 50;
    return this.hub;
  }

  normLabel(n: GraphNode): string {
    return (n.norm_label || stripDiacritics(n.label)).toLowerCase();
  }

  idfOf(term: string): number {
    const cached = this.idf.get(term);
    if (cached !== undefined) return cached;
    let df = 0;
    for (const n of this.nodes.values()) if (this.normLabel(n).includes(term)) df++;
    const v = Math.log(1 + (this.nodes.size || 1) / (1 + df));
    this.idf.set(term, v);
    return v;
  }
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

const stripDiacritics = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '');

/** Word tokens; `_` separates like `-` (Graphify's _search_tokens). */
export function searchTokens(text: string): string[] {
  return stripDiacritics(String(text)).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

const STOPWORDS = new Set([
  'how', 'what', 'why', 'when', 'where', 'which', 'who', 'whom', 'whose',
  'does', 'did', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'can', 'could', 'should', 'would', 'will', 'shall', 'may', 'might', 'must',
  'has', 'have', 'had', 'the', 'and', 'but', 'not', 'for', 'from', 'with',
  'without', 'into', 'onto', 'off', 'that', 'this', 'these', 'those', 'there',
  'here', 'its', 'their', 'them', 'they', 'about', 'any', 'all', 'some',
  'work', 'works', 'working',
  // ticket filler
  'please', 'need', 'needs', 'want', 'wants', 'able', 'also', 'when', 'then', 'there', 'just', 'like',
  'should', 'issue', 'problem', 'ticket', 'client', 'user', 'users', 'page', 'currently',
  'add', 'adds', 'added', 'show', 'shows', 'shown', 'display', 'displayed', 'new', 'request', 'applicable',
  'details', 'detail', 'change', 'changes', 'update', 'updated', 'make', 'ensure', 'field', 'fields',
]);

const RELATIONAL = new Set([
  'call', 'calls', 'called', 'caller', 'callers', 'invoke', 'invokes', 'invoked',
  'use', 'uses', 'used', 'using', 'import', 'imports', 'imported', 'export', 'exports', 'exported',
  'extend', 'extends', 'extended', 'implement', 'implements', 'implemented',
  'depend', 'depends', 'reference', 'references', 'referenced',
]);

export function queryTerms(question: string): string[] {
  const terms: string[] = [];
  for (const raw of question.split(/\s+/)) {
    for (const tok of raw.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []) {
      if (/^[a-z]+$/.test(tok) ? tok.length > 2 : true) terms.push(tok);
    }
  }
  const content = terms.filter((t) => !STOPWORDS.has(t));
  return content.length ? content : terms;
}

const EXACT = 1000;
const PREFIX = 100;
const SUBSTRING = 1;
const SOURCE = 0.5;

/** Graphify's _score_query: tiers per term, IDF-weighted, scaled by term coverage. */
function scoreQuery(g: CodeGraph, terms: string[]) {
  const norm = [...new Set(terms.flatMap((t) => searchTokens(t)))];
  const n = norm.length;
  const idf = new Map(norm.map((t) => [t, g.idfOf(t)]));
  const joined = norm.join(' ');
  const joinedW = Math.max(1, ...norm.map((t) => idf.get(t) ?? 1));
  const ranked: [number, string][] = [];
  const best = new Map<string, { key: [number, number, number, string]; id: string }>();

  for (const node of g.nodes.values()) {
    const normLabel = g.normLabel(node);
    const bare = normLabel.replace(/\(\)+$/, '');
    const labelTokens = searchTokens(node.label).join(' ');
    const source = (node.source_file ?? '').toLowerCase();
    const idLower = node.id.toLowerCase();
    let score = 0;
    if (joined) {
      if ([normLabel, bare, labelTokens, idLower].includes(joined)) score += EXACT * 10 * joinedW;
      else if (normLabel.startsWith(joined) || bare.startsWith(joined) || labelTokens.startsWith(joined)) score += PREFIX * 10 * joinedW;
    }
    let matched = 0;
    let tiered = 0;
    for (const t of norm) {
      const w = idf.get(t) ?? 1;
      let tier = 0;
      let substr = 0;
      let src = 0;
      if (t === normLabel || t === bare) {
        tier = EXACT * w;
        matched++;
      } else if (normLabel.startsWith(t) || bare.startsWith(t)) {
        tier = PREFIX * w;
        matched++;
      } else if (normLabel.includes(t)) {
        substr = SUBSTRING * w;
        score += substr;
        matched++;
      }
      if (source.includes(t)) {
        src = SOURCE * w;
        score += src;
      }
      tiered += tier;
      let single = 0;
      if ([normLabel, bare, labelTokens, idLower].includes(t)) single = EXACT * 10 * w;
      else if (normLabel.startsWith(t) || bare.startsWith(t) || labelTokens.startsWith(t)) single = PREFIX * 10 * w;
      single += tier + substr + src;
      if (single > 0) {
        const key: [number, number, number, string] = [-single, -g.degree(node.id), node.label.length, node.id];
        const cur = best.get(t);
        if (!cur || compareKey(key, cur.key) < 0) best.set(t, { key, id: node.id });
      }
    }
    if (tiered) score += tiered * (matched / n) ** 2;
    if (score > 0) ranked.push([score, node.id]);
  }
  ranked.sort((a, b) => b[0] - a[0] || (g.nodes.get(a[1])!.label.length - g.nodes.get(b[1])!.label.length) || (a[1] < b[1] ? -1 : 1));
  return { ranked, bestByTerm: new Map([...best].map(([t, v]) => [t, v.id])) };
}

function compareKey(a: [number, number, number, string], b: [number, number, number, string]): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return (a[i] as number) - (b[i] as number);
  return a[3] < b[3] ? -1 : a[3] > b[3] ? 1 : 0;
}

/** Top seeds within 20% of the best, then one per query term that matched anything. */
function pickSeeds(g: CodeGraph, ranked: [number, string][], bestByTerm: Map<string, string>, maxK = 3): string[] {
  if (!ranked.length) return [];
  const top = ranked[0][0];
  const seeds: string[] = [];
  const labels = new Set<string>();
  for (const [score, id] of ranked) {
    if (seeds.length >= maxK) break;
    if (seeds.length && score < top * 0.2) break;
    const key = g.normLabel(g.nodes.get(id)!) || id;
    if (labels.has(key)) continue;
    labels.add(key);
    seeds.push(id);
  }
  for (const term of [...bestByTerm.keys()].sort()) {
    const id = bestByTerm.get(term)!;
    const key = g.normLabel(g.nodes.get(id)!) || id;
    if (!seeds.includes(id) && !labels.has(key)) {
      labels.add(key);
      seeds.push(id);
    }
  }
  return seeds;
}

function bfs(g: CodeGraph, seeds: string[], depth: number): Set<string> {
  const hub = g.hubThreshold();
  const seedSet = new Set(seeds);
  const visited = new Set(seeds);
  let frontier = new Set(seeds);
  for (let i = 0; i < depth; i++) {
    const next = new Set<string>();
    for (const n of frontier) {
      if (!seedSet.has(n) && g.degree(n) >= hub) continue;
      for (const nb of g.neighbours(n)) if (!visited.has(nb)) next.add(nb);
    }
    for (const n of next) visited.add(n);
    frontier = next;
  }
  return visited;
}

const clean = (s: unknown) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').slice(0, 300);

/** Graphify's _subgraph_to_text: seeds first, then by distance and degree; ~3 chars per token. */
function subgraphToText(g: CodeGraph, nodes: Set<string>, seeds: string[], budget: number): string {
  const seedHits = seeds.filter((s) => nodes.has(s));
  const dist = new Map(seedHits.map((s) => [s, 0]));
  let frontier = seedHits;
  let hop = 0;
  while (frontier.length) {
    hop++;
    const next: string[] = [];
    for (const n of frontier) for (const nb of g.neighbours(n)) if (nodes.has(nb) && !dist.has(nb)) { dist.set(nb, hop); next.push(nb); }
    frontier = next;
  }
  const rest = [...nodes].filter((n) => !seedHits.includes(n))
    .sort((a, b) => (dist.get(a) ?? 1 << 30) - (dist.get(b) ?? 1 << 30) || g.degree(b) - g.degree(a) || (a < b ? -1 : 1));
  const lines: string[] = [];
  for (const id of [...seedHits, ...rest]) {
    const d = g.nodes.get(id)!;
    lines.push(`NODE ${clean(d.label)} [src=${clean(d.source_file)} loc=${clean(d.source_location)} community=${clean(d.community_name ?? d.community)}]`);
  }
  for (const id of nodes) {
    for (const e of g.out.get(id) ?? []) {
      if (!nodes.has(e.target)) continue;
      const at = e.source_location ? ` at=${clean(e.source_file)}:${clean(e.source_location)}` : '';
      lines.push(`EDGE ${clean(g.nodes.get(e.source)!.label)} --${clean(e.relation)} [${clean(e.confidence)}]--> ${clean(g.nodes.get(e.target)!.label)}${at}`);
    }
  }
  const output = lines.join('\n');
  const chars = budget * 3;
  if (output.length <= chars) return output;
  let cut = output.slice(0, chars).lastIndexOf('\n');
  if (cut <= 0) cut = chars;
  const seedEnd = lines.slice(0, seedHits.length).reduce((n, l) => n + l.length + 1, 0) - 1;
  if (seedHits.length) cut = Math.max(cut, Math.min(seedEnd, output.length));
  const total = lines.filter((l) => l.startsWith('NODE ')).length;
  const shown = output.slice(0, cut).split('\n').filter((l) => l.startsWith('NODE ')).length;
  return `[!] TRUNCATED: showing ${shown} of ${total} nodes (~${budget}-token budget).\n\n${output.slice(0, cut)}\n... (${total - shown} more nodes cut)`;
}

export type QueryResult = { text: string; seeds: GraphNode[]; nodes: number };

/** `graphify query "<question>"`: BFS around the best matches, rendered under a token budget. */
export function query(g: CodeGraph, question: string, opts: { depth?: number; budget?: number } = {}): QueryResult {
  const depth = opts.depth ?? 2;
  const budget = opts.budget ?? 2000;
  const terms = queryTerms(question);
  const { ranked, bestByTerm } = scoreQuery(g, terms);
  const intent = [...bestByTerm.keys()].filter((t) => RELATIONAL.has(t));
  if (intent.length && terms.some((t) => !RELATIONAL.has(t))) for (const t of intent) bestByTerm.delete(t);
  const seeds = pickSeeds(g, ranked, bestByTerm);
  if (!seeds.length) return { text: 'No matching nodes found.', seeds: [], nodes: 0 };
  const nodes = bfs(g, seeds, depth);
  const header = `Traversal: BFS depth=${depth} | Start: ${JSON.stringify(seeds.map((s) => g.nodes.get(s)!.label))} | ${nodes.size} nodes found\n\n`;
  return { text: header + subgraphToText(g, nodes, seeds, budget), seeds: seeds.map((s) => g.nodes.get(s)!), nodes: nodes.size };
}

/* ---- affected ------------------------------------------------------------ */

export const AFFECTED_RELATIONS = [
  'calls', 'indirect_call', 'references', 'imports', 'imports_from', 'dynamic_import', 're_exports',
  'inherits', 'extends', 'implements', 'uses', 'mixes_in', 'embeds', 'requires',
];

const nfc = (s: string) => s.normalize('NFC').toLowerCase();
const bareName = (l: string) => { const n = nfc(l); return n.endsWith('()') ? n.slice(0, -2) : n; };
const basename = (p: string) => p.split('/').pop() ?? p;

/** Graphify's resolve_seed: an id, a unique label, a bare callable name, a file path, or a unique substring. */
export function resolveSeed(g: CodeGraph, q: string): string | null {
  const queryText = q.replace(/[/\\]+$/, '') || q;
  if (g.nodes.has(queryText)) return queryText;
  const lower = nfc(queryText);
  const unique = (ids: string[]) => (ids.length === 1 ? ids[0] : null);
  const all = [...g.nodes.values()];
  const exact = unique(all.filter((n) => nfc(n.label) === lower).map((n) => n.id));
  if (exact) return exact;
  const bare = unique(all.filter((n) => bareName(n.label) === bareName(lower)).map((n) => n.id));
  if (bare) return bare;
  const path = lower.replace(/^\.\//, '');
  const inFile = all.filter((n) => nfc(n.source_file ?? '') === path);
  if (inFile.length === 1) return inFile[0].id;
  if (inFile.length) {
    const base = nfc(basename(path));
    const pick = (list: GraphNode[]) => (list.length === 1 ? list[0].id : null);
    const fileNode = pick(inFile.filter((n) => n.source_location === 'L1' && nfc(n.label) === base))
      ?? pick(inFile.filter((n) => n.source_location === 'L1'))
      ?? pick(inFile.filter((n) => nfc(n.label) === base));
    if (fileNode) return fileNode;
  }
  return unique(all.filter((n) => nfc(n.label).includes(lower)).map((n) => n.id));
}

export type AffectedHit = { node: GraphNode; depth: number; via: string; at: string | null };

/** `graphify affected`: walk incoming dependency edges from the seed (and its members). */
export function affected(g: CodeGraph, seed: string, depth = 2, relations = AFFECTED_RELATIONS): AffectedHit[] {
  const rel = new Set(relations);
  const seen = new Set([seed]);
  const queue: [string, number][] = [[seed, 0]];
  for (const e of g.out.get(seed) ?? []) {
    if ((e.relation === 'method' || e.relation === 'contains') && !seen.has(e.target)) {
      seen.add(e.target);
      queue.push([e.target, 0]);
    }
  }
  const hits: AffectedHit[] = [];
  while (queue.length) {
    const [cur, d] = queue.shift()!;
    if (d >= depth) continue;
    for (const e of g.in.get(cur) ?? []) {
      if (!rel.has(e.relation) || seen.has(e.source)) continue;
      seen.add(e.source);
      hits.push({ node: g.nodes.get(e.source)!, depth: d + 1, via: e.relation, at: e.source_location ? `${e.source_file ?? ''}:${e.source_location}` : null });
      queue.push([e.source, d + 1]);
    }
  }
  return hits;
}

/** Everything that depends on a file: `affected` from the file node, else from each symbol in it. */
export function affectedByFile(g: CodeGraph, path: string, depth = 2): AffectedHit[] {
  const p = path.replace(/^\.\//, '');
  const inFile = [...g.nodes.values()].filter((n) => n.source_file && (n.source_file === p || p.endsWith(`/${n.source_file}`) || n.source_file.endsWith(`/${p}`)));
  if (!inFile.length) return [];
  const own = new Set(inFile.map((n) => n.id));
  const seeds = new Set<string>();
  const fileNode = resolveSeed(g, inFile[0].source_file!);
  if (fileNode) seeds.add(fileNode);
  for (const n of inFile) seeds.add(n.id);
  const out = new Map<string, AffectedHit>();
  for (const s of seeds) {
    for (const h of affected(g, s, depth)) {
      if (own.has(h.node.id)) continue;
      const cur = out.get(h.node.id);
      if (!cur || h.depth < cur.depth) out.set(h.node.id, h);
    }
  }
  return [...out.values()].sort((a, b) => a.depth - b.depth || (a.node.source_file ?? '').localeCompare(b.node.source_file ?? ''));
}

export function formatAffected(g: CodeGraph, label: string, hits: AffectedHit[], limit = 60): string {
  if (!hits.length) return `Nothing in the map depends on ${label}.`;
  const lines = hits.slice(0, limit).map((h) => `- ${h.node.label} [${h.via}${h.depth > 1 ? `, ${h.depth} steps away` : ''}] ${h.at ?? h.node.source_file ?? '-'}`);
  if (hits.length > limit) lines.push(`… and ${hits.length - limit} more`);
  return lines.join('\n');
}

/* ---- path and explain ---------------------------------------------------- */

/** Picks one node for a name: resolveSeed, else the best query match. */
export function findNode(g: CodeGraph, name: string): string | null {
  const direct = resolveSeed(g, name);
  if (direct) return direct;
  const { ranked } = scoreQuery(g, queryTerms(name));
  return ranked[0]?.[1] ?? null;
}

export type PathResult = { found: boolean; directed: boolean; hops: { from: GraphNode; relation: string; to: GraphNode; forward: boolean }[]; text: string };

/** `graphify path "A" "B"`: shortest path following edge direction, else ignoring it. */
export function shortestPath(g: CodeGraph, a: string, b: string): PathResult {
  const from = findNode(g, a);
  const to = findNode(g, b);
  if (!from || !to) return { found: false, directed: true, hops: [], text: `No node matches "${!from ? a : b}".` };
  for (const directed of [true, false]) {
    const prev = new Map<string, { node: string; edge: GraphEdge; forward: boolean } | null>([[from, null]]);
    const queue = [from];
    while (queue.length && !prev.has(to)) {
      const cur = queue.shift()!;
      const steps = [
        ...(g.out.get(cur) ?? []).map((e) => ({ next: e.target, edge: e, forward: true })),
        ...(directed ? [] : (g.in.get(cur) ?? []).map((e) => ({ next: e.source, edge: e, forward: false }))),
      ];
      for (const s of steps) {
        if (prev.has(s.next)) continue;
        prev.set(s.next, { node: cur, edge: s.edge, forward: s.forward });
        queue.push(s.next);
      }
    }
    if (!prev.has(to)) continue;
    const hops: PathResult['hops'] = [];
    for (let at = to; prev.get(at); at = prev.get(at)!.node) {
      const p = prev.get(at)!;
      hops.unshift({ from: g.nodes.get(p.node)!, relation: p.edge.relation, to: g.nodes.get(at)!, forward: p.forward });
    }
    const text = [`${g.nodes.get(from)!.label} → ${g.nodes.get(to)!.label} (${hops.length} step${hops.length === 1 ? '' : 's'}${directed ? '' : ', ignoring direction'})`,
      ...hops.map((h) => (h.forward ? `  ${h.from.label} --${h.relation}--> ${h.to.label}` : `  ${h.from.label} <--${h.relation}-- ${h.to.label}`))].join('\n');
    return { found: true, directed, hops, text };
  }
  return { found: false, directed: false, hops: [], text: `No path between ${g.nodes.get(from)!.label} and ${g.nodes.get(to)!.label}.` };
}

export type Explanation = {
  node: GraphNode;
  degree: number;
  incoming: { node: GraphNode; relation: string; at: string | null }[];
  outgoing: { node: GraphNode; relation: string; at: string | null }[];
  text: string;
};

/** `graphify explain "X"`: the node and every connection. */
export function explain(g: CodeGraph, name: string): Explanation | null {
  const id = findNode(g, name);
  if (!id) return null;
  const node = g.nodes.get(id)!;
  const at = (e: GraphEdge) => (e.source_location ? `${e.source_file ?? ''}:${e.source_location}` : null);
  const incoming = (g.in.get(id) ?? []).map((e) => ({ node: g.nodes.get(e.source)!, relation: e.relation, at: at(e) }));
  const outgoing = (g.out.get(id) ?? []).map((e) => ({ node: g.nodes.get(e.target)!, relation: e.relation, at: at(e) }));
  const text = [
    `Node: ${node.label}`,
    `  Source:    ${node.source_file ?? '-'} ${node.source_location ?? ''}`.trimEnd(),
    `  Community: ${node.community_name ?? node.community ?? '-'}`,
    `  Degree:    ${g.degree(id)}`,
    '',
    `Connections (${incoming.length + outgoing.length}):`,
    ...incoming.map((c) => `  <-- ${c.node.label} [${c.relation}]${c.at ? ` ${c.at}` : ''}`),
    ...outgoing.map((c) => `  --> ${c.node.label} [${c.relation}]${c.at ? ` ${c.at}` : ''}`),
  ].join('\n');
  return { node, degree: g.degree(id), incoming, outgoing, text };
}

/** Nodes defined in the given files. */
export function nodesInFiles(g: CodeGraph, paths: string[]): GraphNode[] {
  const wanted = paths.map((p) => p.replace(/^\.\//, ''));
  return [...g.nodes.values()].filter((n) => n.source_file && wanted.some((p) => p === n.source_file || p.endsWith(`/${n.source_file}`) || n.source_file!.endsWith(`/${p}`)));
}
