import 'server-only';
import { Sandbox } from '@vercel/sandbox';
import { installationToken, type Installation } from './github';
import { affectedByFile, CodeGraph, formatAffected, nodesInFiles, query } from './graph-query';
import { optionalSecret } from './secrets';
import { serviceClient } from './supabase';

/**
 * A map of each project's code, made with Graphify (https://github.com/Graphify-Labs/graphify).
 *
 * Graphify parses the repository with tree-sitter (code only: no documents,
 * no AI extraction) in a Vercel Sandbox that clones it with a short-lived
 * GitHub App token:
 *
 *   queued ─► running (sandbox started, Graphify detached) ─► ready | failed
 *
 * The worker's tick starts queued runs (a few at a time) and polls running
 * ones. A finished run leaves, in the private project-maps bucket: the graph
 * (graph.json), its report, the interactive map, the hubs, a call-flow page, a
 * file tree, a wiki, a picture, lessons from past tasks, and Graphify's cache
 * so the next run only re-parses what changed. The one AI call is naming the
 * groups (Claude Haiku), made only when the tenant has an Anthropic key.
 *
 * The agents use the graph through graph-query.ts: the part of the code a
 * request is about, what depends on the files a plan changes, and the hubs.
 * Maps are made when a project is first imported, after every merge, and on
 * request.
 */

export const GRAPHIFY_VERSION = '0.9.69';
export const MAP_BUCKET = 'project-maps';
const CONCURRENCY = Number(process.env.AGENTSYNC_MAP_CONCURRENCY ?? 2);
const RUN_LIMIT_MS = 30 * 60_000;
const OUT = '/tmp/agentsync';
const MAX_FILE_BYTES = 95 * 1024 * 1024;
/** Names the map's groups when the tenant has an Anthropic key: a couple of short calls per run. */
const LABEL_MODEL = 'claude-haiku-4-5';

const db = () => serviceClient();

type MapRow = {
  project_id: string;
  tenant_id: string;
  status: 'queued' | 'running' | 'ready' | 'failed';
  reason: string | null;
  sandbox_name: string | null;
  started_at: string | null;
  files: Record<string, number> | null;
  rerun: boolean;
  attempts: number;
};

type ProjectCtx = {
  project: { id: string; name: string };
  repository: { github_owner: string; repository: string; default_branch: string | null } | null;
  github: Installation | null;
};

/** Sandboxes need Vercel credentials: automatic (OIDC) on Vercel, or a token elsewhere. */
export function mapsAvailable(): boolean {
  return Boolean(process.env.VERCEL || process.env.VERCEL_OIDC_TOKEN || (process.env.VERCEL_ACCESS_TOKEN && process.env.VERCEL_TEAM_ID && process.env.VERCEL_PROJECT_ID));
}

function credentials() {
  const { VERCEL_ACCESS_TOKEN: token, VERCEL_TEAM_ID: teamId, VERCEL_PROJECT_ID: projectId } = process.env;
  return token && teamId && projectId ? { token, teamId, projectId } : {};
}

export async function queueMap(projectId: string, reason: 'import' | 'merge' | 'person', taskId: string | null = null) {
  const { error } = await db().rpc('agentsync_map_queue', { p_project_id: projectId, p_reason: reason, p_task_id: taskId });
  if (error) throw error;
}

async function setMap(projectId: string, fields: Record<string, unknown>) {
  const { error } = await db().rpc('agentsync_map_update', { p_project_id: projectId, p_fields: fields });
  if (error) throw error;
}

// The whole run, detached inside the sandbox. It never fails the shell: it
// records its exit code in exit.txt, which the worker polls for.
//
// Verified against graphifyy 0.9.69:
//   extract --code-only   parses the code (tree-sitter; [sql] adds SQL) → graph.json
//   cluster-only          groups it → GRAPH_REPORT.md, graph.html; groups are
//                         named after their most-connected item (no model)
// Then, none of which can fail the run (their output goes to extras.txt):
//   label                 AI names for the groups (Claude Haiku), only when the
//                         tenant has an Anthropic key; on failure the item-named
//                         outputs are put back
//   god-nodes --json      the most-connected code (hubs)
//   export callflow-html  architecture / call-flow diagrams (Mermaid)
//   tree                  collapsible file → symbol tree (D3)
//   export wiki           one article per group, packed into wiki.json
//   export svg            a static picture of the graph (matplotlib, scipy)
//   reflect               lessons from past tasks (AgentSync writes them as
//                         Graphify memory files before the run)
// Every graphify call runs under `env -i`: no key reaches it except label's.
const SCRIPT = `
set -u
mkdir -p ${OUT}
cd /vercel/sandbox
PY="$(command -v python3)"
{
  # A virtual environment where the image supports one; otherwise the image's
  # pip (fetched first if missing) installs Graphify into a folder of its own.
  if "$PY" -m venv /tmp/graphify-venv >/dev/null 2>&1 && [ -x /tmp/graphify-venv/bin/python ]; then
    RUNPY=/tmp/graphify-venv/bin/python
    "$RUNPY" -m pip install --quiet --disable-pip-version-check "graphifyy[sql,anthropic]==${GRAPHIFY_VERSION}" matplotlib scipy
  else
    rm -rf /tmp/graphify-venv
    if ! "$PY" -m pip --version >/dev/null 2>&1; then
      curl -sSfL https://bootstrap.pypa.io/get-pip.py -o /tmp/get-pip.py &&
      PIP_BREAK_SYSTEM_PACKAGES=1 "$PY" /tmp/get-pip.py --quiet --user
    fi &&
    PIP_BREAK_SYSTEM_PACKAGES=1 "$PY" -m pip install --quiet --disable-pip-version-check --target /tmp/graphify-lib "graphifyy[sql,anthropic]==${GRAPHIFY_VERSION}" matplotlib scipy &&
    RUNPY="$PY"
  fi &&
  # The sandbox's Python is built without the bz2/lzma C modules. NetworkX
  # imports bz2 without using it, so a stand-in is enough for code maps.
  mkdir -p /tmp/graphify-stubs &&
  "$RUNPY" - <<'STUBS' &&
import importlib, os
stubs = {
    "_bz2": "class BZ2Compressor:\\n    def __init__(self, *a, **k): raise OSError('bz2 is not available')\\n"
            "class BZ2Decompressor(BZ2Compressor): pass\\n",
    "_lzma": "class LZMAError(Exception): pass\\n"
             "class LZMACompressor:\\n    def __init__(self, *a, **k): raise LZMAError('lzma is not available')\\n"
             "class LZMADecompressor(LZMACompressor): pass\\n"
             "def is_check_supported(check): return False\\n"
             "def _encode_filter_properties(f): raise LZMAError('lzma is not available')\\n"
             "_decode_filter_properties = _encode_filter_properties\\n"
             "FORMAT_AUTO, FORMAT_XZ, FORMAT_ALONE, FORMAT_RAW = 0, 1, 2, 3\\n"
             "CHECK_NONE, CHECK_CRC32, CHECK_CRC64, CHECK_SHA256, CHECK_ID_MAX, CHECK_UNKNOWN = 0, 1, 4, 10, 15, 16\\n"
             "PRESET_DEFAULT, PRESET_EXTREME = 6, 0x80000000\\n",
}
for name, body in stubs.items():
    try:
        importlib.import_module(name)
    except ImportError:
        with open(os.path.join("/tmp/graphify-stubs", name + ".py"), "w") as f:
            f.write(body)
STUBS
  G() { env -i HOME=/tmp PATH=/usr/local/bin:/usr/bin:/bin PYTHONPATH=/tmp/graphify-lib:/tmp/graphify-stubs MPLBACKEND=Agg "$RUNPY" -m graphify "$@"; } &&
  if [ -f ${OUT}/cache.in.tgz ]; then tar -xzf ${OUT}/cache.in.tgz; fi &&
  UPDATE="" && if [ -f graphify-out/manifest.json ] && [ -f graphify-out/graph.json ]; then UPDATE="--update"; fi &&
  G extract . --code-only $UPDATE &&
  G cluster-only .
} > ${OUT}/log.txt 2>&1
code=$?
git rev-parse HEAD > ${OUT}/commit.txt 2>/dev/null
if [ $code -eq 0 ]; then
  {
    if [ -n "\${LABEL_KEY:-}" ]; then
      mkdir -p /tmp/before-label && cp -a graphify-out/GRAPH_REPORT.md graphify-out/graph.json graphify-out/graph.html /tmp/before-label/ 2>/dev/null
      env -i HOME=/tmp PATH=/usr/local/bin:/usr/bin:/bin PYTHONPATH=/tmp/graphify-lib:/tmp/graphify-stubs ANTHROPIC_API_KEY="$LABEL_KEY" \\
        "$RUNPY" -m graphify label . --backend claude --model ${LABEL_MODEL} > ${OUT}/label.txt 2>&1
        lc=$?
      if [ $lc -ne 0 ] || grep -qi "labeling failed\\|batch .* failed" ${OUT}/label.txt; then
        cp -a /tmp/before-label/. graphify-out/ && rm -f graphify-out/.graphify_labels.json graphify-out/.graphify_labels.json.sig
        echo failed > ${OUT}/label.status
      else
        echo ok > ${OUT}/label.status
      fi
    fi
    unset LABEL_KEY
    # The exports below read group names from a labels file, which Graphify
    # only keeps for AI names: give them the names graph.json carries.
    env -i PROJECT_NAME="\${PROJECT_NAME:-}" "$RUNPY" - <<'LABELS' || true
import json, os
g = json.load(open("graphify-out/graph.json", encoding="utf-8"))
names = {}
for n in g.get("nodes", []):
    if n.get("community") is not None and n.get("community_name"):
        names.setdefault(str(n["community"]), n["community_name"])
json.dump(names, open("/tmp/labels.json", "w", encoding="utf-8"), ensure_ascii=False)
# Call-flow's own sections are keyword guesses tuned to Graphify's codebase:
# give it this project's largest subsystems instead, and its name.
sizes = {}
for n in g.get("nodes", []):
    if n.get("community") is not None:
        sizes[n["community"]] = sizes.get(n["community"], 0) + 1
ranked = sorted(sizes, key=lambda c: -sizes[c])
sections = [{"id": "overview", "name": "Architecture Overview", "communities": []}]
sections += [{"id": "c%s" % c, "name": names.get(str(c), "Subsystem %s" % c), "communities": [c]} for c in ranked[:14]]
if ranked[14:]:
    sections.append({"id": "other", "name": "Other", "communities": ranked[14:]})
json.dump(sections, open("/tmp/sections.json", "w", encoding="utf-8"), ensure_ascii=False)
g["project_name"] = os.environ.get("PROJECT_NAME") or "Project"
json.dump(g, open("/tmp/graph-named.json", "w", encoding="utf-8"), ensure_ascii=False)
LABELS
    L="--labels /tmp/labels.json"
    G god-nodes --top 30 --json > ${OUT}/hubs.json || rm -f ${OUT}/hubs.json
    G export callflow-html /tmp/graph-named.json $L --sections /tmp/sections.json --report graphify-out/GRAPH_REPORT.md --output ${OUT}/callflow.html || true
    G tree --graph graphify-out/graph.json --output ${OUT}/tree.html --label "\${PROJECT_NAME:-project}" || true
    G export wiki --graph graphify-out/graph.json $L && env -i "$RUNPY" - <<'WIKI' || true
import json, os
d = "graphify-out/wiki"
out = {f: open(os.path.join(d, f), encoding="utf-8").read() for f in sorted(os.listdir(d)) if f.endswith(".md")}
json.dump(out, open("${OUT}/wiki.json", "w", encoding="utf-8"), ensure_ascii=False)
WIKI
    # A picture of a big graph is slow to draw and heavy to open: capped at 5 minutes.
    timeout 300 env -i HOME=/tmp PATH=/usr/local/bin:/usr/bin:/bin PYTHONPATH=/tmp/graphify-lib:/tmp/graphify-stubs MPLBACKEND=Agg "$RUNPY" -m graphify export svg --graph graphify-out/graph.json $L && cp graphify-out/graph.svg ${OUT}/graph.svg || true
    if ls ${OUT}/memory/*.md >/dev/null 2>&1; then
      mkdir -p graphify-out/memory && cp ${OUT}/memory/*.md graphify-out/memory/ &&
      G reflect --graph graphify-out/graph.json --out ${OUT}/LESSONS.md || true
    fi
  } > ${OUT}/extras.txt 2>&1
  tar -czf ${OUT}/cache.tgz graphify-out/cache graphify-out/manifest.json graphify-out/graph.json 2>/dev/null || true
fi
echo $code > ${OUT}/exit.txt
`;

/** A past task's outcome, as a Graphify memory file (the format `graphify save-result` writes). */
function memoryFile(f: FeedbackRow): string {
  const q = (v: string) => JSON.stringify(v.replace(/[\r\n]+/g, ' '));
  return [
    '---',
    'type: "query"',
    `date: ${q(f.created_at)}`,
    `question: ${q(f.question)}`,
    'contributor: "agentsync"',
    `outcome: ${q(f.outcome)}`,
    ...(f.correction ? [`correction: ${q(f.correction)}`] : []),
    `source_nodes: [${f.source_nodes.map(q).join(', ')}]`,
    '---',
    '',
    `# Q: ${f.question.replace(/[\r\n]+/g, ' ')}`,
    '',
    '## Answer',
    '',
    f.answer ?? '',
    '',
    '## Outcome',
    '',
    `- Signal: ${f.outcome}`,
    ...(f.correction ? [`- Correction: ${f.correction.replace(/[\r\n]+/g, ' ')}`] : []),
    '',
    '## Source Nodes',
    '',
    ...f.source_nodes.map((n) => `- ${n}`),
    '',
  ].join('\n');
}

type FeedbackRow = {
  id: string;
  question: string;
  answer: string | null;
  source_nodes: string[];
  outcome: 'useful' | 'dead_end' | 'corrected';
  correction: string | null;
  created_at: string;
};

async function start(row: MapRow): Promise<void> {
  const { data } = await db().rpc('agentsync_project_context', { p_project_id: row.project_id });
  const ctx = data as ProjectCtx | null;
  if (!ctx?.repository || !ctx.github) {
    await setMap(row.project_id, { status: 'failed', error: 'This project has no connected GitHub repository.', finished_at: new Date().toISOString() });
    return;
  }

  const name = `agentsync-map-${row.project_id.slice(0, 8)}-${Date.now().toString(36)}`;
  const { data: claimed } = await db().rpc('agentsync_map_claim', { p_project_id: row.project_id, p_sandbox_name: name });
  if (claimed !== true) return;

  try {
    const { data: inputs } = await db().rpc('agentsync_map_inputs', { p_project_id: row.project_id });
    const { anthropic_key_reference: keyRef, feedback } = (inputs ?? {}) as { anthropic_key_reference?: string | null; feedback?: FeedbackRow[] };
    const labelKey = await optionalSecret(keyRef ?? null) ?? process.env.ANTHROPIC_API_KEY ?? null;

    const token = await installationToken(ctx.github);
    const sandbox = await Sandbox.create({
      name,
      source: {
        type: 'git',
        url: `https://github.com/${ctx.repository.github_owner}/${ctx.repository.repository}.git`,
        username: 'x-access-token',
        password: token,
        depth: 1,
        ...(ctx.repository.default_branch ? { revision: ctx.repository.default_branch } : {}),
      },
      runtime: 'python3.13',
      resources: { vcpus: 2 },
      timeout: RUN_LIMIT_MS + 5 * 60_000,
      tags: { app: 'agentsync', job: 'project-map' },
      ...credentials(),
    });

    await sandbox.runCommand({ cmd: 'mkdir', args: ['-p', `${OUT}/memory`] });
    const files: { path: string; content: Buffer }[] = [];
    // The previous run's cache, so this run only re-parses what changed.
    if (row.files?.['cache.tgz']) {
      const { data: cache } = await db().storage.from(MAP_BUCKET).download(`${row.project_id}/cache.tgz`);
      if (cache) files.push({ path: `${OUT}/cache.in.tgz`, content: Buffer.from(await cache.arrayBuffer()) });
    }
    // Past tasks' outcomes, for `graphify reflect`.
    for (const f of feedback ?? []) {
      files.push({ path: `${OUT}/memory/${f.created_at.slice(0, 10)}_${f.id.slice(0, 8)}.md`, content: Buffer.from(memoryFile(f)) });
    }
    if (files.length) await sandbox.writeFiles(files);

    await sandbox.runCommand({
      cmd: 'bash',
      args: ['-c', SCRIPT],
      detached: true,
      env: { PROJECT_NAME: ctx.project.name, ...(labelKey ? { LABEL_KEY: labelKey } : {}) },
    });
  } catch (e) {
    await setMap(row.project_id, { status: 'failed', error: `Could not start the sandbox: ${(e as Error).message}`.slice(0, 1000), finished_at: new Date().toISOString() });
  }
}

type Graph = { nodes?: unknown[]; links?: unknown[]; edges?: unknown[] };

function statsOf(graph: Graph): Record<string, number> {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph.links) ? graph.links : Array.isArray(graph.edges) ? graph.edges : [];
  const communities = new Set<unknown>();
  const files = new Set<unknown>();
  for (const n of nodes as Record<string, unknown>[]) {
    if (n.community !== undefined && n.community !== null) communities.add(n.community);
    const f = n.source_file ?? n.file ?? n.path;
    if (f) files.add(f);
  }
  return { nodes: nodes.length, edges: edges.length, communities: communities.size, files: files.size };
}

/** Everything a run can leave behind: [stored name, path in the sandbox, type]. */
const OUTPUTS: [string, string, string][] = [
  ['graph.json', '/vercel/sandbox/graphify-out/graph.json', 'application/json'],
  ['graph.html', '/vercel/sandbox/graphify-out/graph.html', 'text/html'],
  ['GRAPH_REPORT.md', '/vercel/sandbox/graphify-out/GRAPH_REPORT.md', 'text/markdown'],
  ['cache.tgz', `${OUT}/cache.tgz`, 'application/gzip'],
  ['hubs.json', `${OUT}/hubs.json`, 'application/json'],
  ['callflow.html', `${OUT}/callflow.html`, 'text/html'],
  ['tree.html', `${OUT}/tree.html`, 'text/html'],
  ['wiki.json', `${OUT}/wiki.json`, 'application/json'],
  ['graph.svg', `${OUT}/graph.svg`, 'image/svg+xml'],
  ['LESSONS.md', `${OUT}/LESSONS.md`, 'text/markdown'],
];

async function finish(row: MapRow, sandbox: Sandbox, exitCode: number): Promise<void> {
  const read = (path: string) => sandbox.readFileToBuffer({ path }).catch(() => null);
  const commit = (await read(`${OUT}/commit.txt`))?.toString('utf8').trim() || null;

  if (exitCode !== 0) {
    const log = (await read(`${OUT}/log.txt`))?.toString('utf8') ?? '';
    await setMap(row.project_id, {
      status: 'failed',
      error: `Graphify stopped (exit ${exitCode}): ${log.slice(-1500) || 'no output'}`,
      finished_at: new Date().toISOString(),
    });
    return;
  }

  const files: Record<string, number> = {};
  let stats: Record<string, number | string> | null = null;
  for (const [key, path, type] of OUTPUTS) {
    const buf = await read(path);
    if (!buf || buf.length > MAX_FILE_BYTES) {
      // A file this run didn't make isn't left over from an earlier one.
      if (row.files?.[key]) await db().storage.from(MAP_BUCKET).remove([`${row.project_id}/${key}`]).catch(() => undefined);
      continue;
    }
    const { error } = await db().storage.from(MAP_BUCKET).upload(`${row.project_id}/${key}`, buf, { contentType: type, upsert: true });
    if (error) throw error;
    files[key] = buf.length;
    if (key === 'graph.json') {
      try {
        stats = statsOf(JSON.parse(buf.toString('utf8')) as Graph);
      } catch {
        stats = null;
      }
    }
  }
  if (!files['graph.json'] && !files['GRAPH_REPORT.md']) {
    await setMap(row.project_id, { status: 'failed', error: 'Graphify finished but wrote no graph.', finished_at: new Date().toISOString() });
    return;
  }
  // How the groups got their names: by Claude, or after their main item.
  const label = (await read(`${OUT}/label.status`))?.toString('utf8').trim();
  if (stats) stats.labels = label === 'ok' ? LABEL_MODEL : label === 'failed' ? 'failed' : 'items';
  const now = new Date().toISOString();
  await setMap(row.project_id, {
    status: row.rerun ? 'queued' : 'ready',
    rerun: false,
    commit_sha: commit,
    mapped_at: now,
    finished_at: now,
    graphify_version: GRAPHIFY_VERSION,
    stats,
    files,
    error: null,
  });
}

async function poll(row: MapRow): Promise<void> {
  if (!row.sandbox_name) return;
  const overdue = row.started_at && Date.now() - Date.parse(row.started_at) > RUN_LIMIT_MS;
  let sandbox: Sandbox;
  try {
    sandbox = await Sandbox.get({ name: row.sandbox_name, ...credentials() });
  } catch (e) {
    // A lookup can miss briefly; only give up once the run is overdue.
    if (!overdue) return;
    await setMap(row.project_id, { status: 'failed', error: `The map run's sandbox could not be found: ${(e as Error).message}`.slice(0, 1000), finished_at: new Date().toISOString() });
    return;
  }
  try {
    const exit = await sandbox.readFileToBuffer({ path: `${OUT}/exit.txt` }).catch(() => null);
    if (exit) {
      await finish(row, sandbox, Number(exit.toString('utf8').trim()));
    } else if (overdue) {
      await setMap(row.project_id, { status: 'failed', error: 'Mapping took longer than 30 minutes and was stopped.', finished_at: new Date().toISOString() });
    } else {
      return; // still running
    }
  } catch (e) {
    await setMap(row.project_id, { status: 'failed', error: `Could not collect the map: ${(e as Error).message}`.slice(0, 1000), finished_at: new Date().toISOString() });
  }
  // Deleted with its snapshots once collected, so a run leaves nothing stored (or billed).
  await sandbox.delete({ deleteOrphanSnapshots: true }).catch(() => sandbox.stop().catch(() => undefined));
}

/**
 * Checks one project's running map now (the Map tab calls this while it
 * waits), so a finished run is collected without waiting for the worker.
 */
export async function pollProjectMap(projectId: string): Promise<void> {
  if (!mapsAvailable()) return;
  const { data } = await db().rpc('agentsync_map_get', { p_project_id: projectId });
  const row = data as MapRow | null;
  if (row?.status === 'running') await poll(row);
}

/** One pass for the worker: collect finished runs, start queued ones. */
export async function tickMaps(): Promise<{ polled: number; started: number } | null> {
  if (!mapsAvailable()) return null;
  const { data, error } = await db().rpc('agentsync_map_work', { p_start_limit: CONCURRENCY });
  if (error) throw error;
  const work = data as { running: MapRow[]; queued: MapRow[] };
  for (const row of work.running) await poll(row).catch((e) => console.error('map poll failed', e));
  for (const row of work.queued) await start(row).catch((e) => console.error('map start failed', e));
  return { polled: work.running.length, started: work.queued.length };
}

/* ---- reading a map --------------------------------------------------------- */

type MapInfo = { files?: Record<string, number> | null; commit_sha?: string | null; mapped_at?: string | null };

async function mapInfo(projectId: string): Promise<MapInfo | null> {
  const { data } = await db().rpc('agentsync_map_get', { p_project_id: projectId });
  return (data as MapInfo | null) ?? null;
}

/** One stored output of the project's current map, or null. */
export async function readMapFile(projectId: string, name: string): Promise<Buffer | null> {
  const { data } = await db().storage.from(MAP_BUCKET).download(`${projectId}/${name}`);
  return data ? Buffer.from(await data.arrayBuffer()) : null;
}

// Parsed graphs, kept while this server instance is warm (keyed by map time).
const graphs = new Map<string, { at: string; graph: CodeGraph }>();

/** The project's code graph, or null when it has no map (or one too big to load here). */
export async function loadCodeGraph(projectId: string): Promise<CodeGraph | null> {
  const info = await mapInfo(projectId);
  const size = info?.files?.['graph.json'];
  if (!size || size > 60 * 1024 * 1024) return null;
  const at = info?.mapped_at ?? '';
  const cached = graphs.get(projectId);
  if (cached && cached.at === at) return cached.graph;
  const raw = await readMapFile(projectId, 'graph.json');
  if (!raw) return null;
  try {
    const graph = CodeGraph.parse(raw.toString('utf8'));
    if (graphs.size > 20) graphs.delete(graphs.keys().next().value!);
    graphs.set(projectId, { at, graph });
    return graph;
  } catch {
    return null;
  }
}

export type Hub = { id: string; label: string; degree: number; source_file: string | null };

/** The most-connected code (`graphify god-nodes`), without package references. */
const IMPORT_RELATIONS = new Set(['imports', 'imports_from', 'dynamic_import', 're_exports']);

/**
 * A package the code imports (react, next, lucide-react) rather than code of
 * the project's own: only ever the target of imports, with nothing inside it.
 * Hugely connected, but changing a file that imports it changes nothing about it.
 */
function isExternalModule(g: CodeGraph, id: string): boolean {
  if ((g.out.get(id) ?? []).length > 0) return false;
  const incoming = g.in.get(id) ?? [];
  return incoming.length > 0 && incoming.every((e) => IMPORT_RELATIONS.has(e.relation));
}

export async function projectHubs(projectId: string, graph?: CodeGraph | null): Promise<Hub[]> {
  const raw = await readMapFile(projectId, 'hubs.json').catch(() => null);
  if (!raw) return [];
  try {
    const g = graph === undefined ? await loadCodeGraph(projectId) : graph;
    return (JSON.parse(raw.toString('utf8')) as { id: string; label: string; degree: number }[])
      .map((h) => ({ ...h, source_file: g?.nodes.get(h.id)?.source_file ?? null }))
      .filter((h) => h.source_file && !(g && isExternalModule(g, h.id)));
  } catch {
    return [];
  }
}

/* ---- for the agents ------------------------------------------------------ */

export type MapBriefing = {
  /** Text for the Analyst/Planner. */
  text: string;
  /** Labels of the nodes the briefing started from (recorded with the task's outcome). */
  seeds: string[];
  /** The files those nodes live in, best match first: worth reading in full. */
  files: string[];
};

/**
 * What the Analyst and Planner get from the map, all computed here from
 * graph.json: the report, lessons from past tasks, the graph around the
 * request (`query`), and what depends on the files it looks likely to touch
 * (`affected`).
 */
export async function mapBriefing(projectId: string, request: string, relevantPaths: string[]): Promise<MapBriefing | null> {
  const info = await mapInfo(projectId);
  if (!info?.files) return null;
  const parts: string[] = [];
  const seeds: string[] = [];
  const files: string[] = [];

  if (info.files['GRAPH_REPORT.md']) {
    const report = await readMapFile(projectId, 'GRAPH_REPORT.md');
    if (report) parts.push(`## Code map report (Graphify, commit ${info.commit_sha?.slice(0, 7) ?? '?'})\n\n${report.toString('utf8').slice(0, 6000)}`);
  }
  if (info.files['LESSONS.md']) {
    const lessons = await readMapFile(projectId, 'LESSONS.md');
    if (lessons) parts.push(`## Lessons from earlier tasks on this project (graphify reflect)\n\n${lessons.toString('utf8').slice(0, 3000)}`);
  }

  const graph = await loadCodeGraph(projectId);
  if (graph) {
    const q = query(graph, request, { depth: 2, budget: 1500 });
    if (q.seeds.length) {
      seeds.push(...q.seeds.map((s) => s.label));
      for (const s of q.seeds) {
        const f = (s.source_file ?? '').replace(/^\.?\//, '');
        if (f && !files.includes(f)) files.push(f);
      }
      parts.push(`## The part of the code this request is about (graphify query)\n\n${q.text}`);
    }
    const deps: string[] = [];
    for (const path of relevantPaths.slice(0, 6)) {
      const hits = affectedByFile(graph, path);
      if (hits.length) deps.push(`### ${path}\n${formatAffected(graph, path, hits, 15)}`);
    }
    if (deps.length) parts.push(`## What depends on the files that look relevant (graphify affected)\n\n${deps.join('\n\n')}`);
  }
  return parts.length ? { text: parts.join('\n\n'), seeds, files: files.slice(0, 6) } : null;
}

export type Impact = {
  /** Markdown: what else the plan's files affect, and which hubs it touches. */
  text: string;
  dependents: number;
  hubs: Hub[];
  /** Node labels in the planned files, recorded with the task's outcome. */
  nodes: string[];
};

/**
 * The blast radius of a plan: everything that depends on the files it
 * changes (`affected`, two steps), and the hubs among them — the code most of
 * the project leans on, where a change needs the closest review.
 */
const MANIFEST = /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|tsconfig[^/]*\.json|jsconfig\.json|composer\.json|go\.mod|go\.sum|Cargo\.(toml|lock)|pyproject\.toml|requirements[^/]*\.txt)$/;

export async function planImpact(projectId: string, files: string[]): Promise<Impact | null> {
  const graph = await loadCodeGraph(projectId);
  if (!graph || !files.length) return null;
  const hubs = await projectHubs(projectId, graph);
  const inPlan = nodesInFiles(graph, files);
  const touchedHubs = hubs.filter((h) => inPlan.some((n) => n.id === h.id));
  const sections: string[] = [];
  const outside = new Set<string>();
  let dependents = 0;
  // Manifests and config (package.json, tsconfig, lockfiles) are "imported" by
  // everything; counting that as impact buries the real callers.
  for (const path of files.filter((f) => !MANIFEST.test(f))) {
    const hits = affectedByFile(graph, path).filter((h) => !files.some((f) => h.node.source_file && (f === h.node.source_file || f.endsWith(`/${h.node.source_file}`))));
    dependents += hits.length;
    for (const h of hits) if (h.node.source_file) outside.add(h.node.source_file);
    if (hits.length) sections.push(`**${path}** — ${hits.length} dependent${hits.length === 1 ? '' : 's'} outside the plan\n${formatAffected(graph, path, hits, 12)}`);
  }
  const lines: string[] = [];
  if (touchedHubs.length) {
    lines.push(`⚠ Changes a hub — code much of the project depends on: ${touchedHubs.map((h) => `\`${h.label}\` (${h.degree} connections, ${h.source_file})`).join(', ')}. Review callers carefully.`);
  }
  const otherFiles = outside.size;
  lines.push(dependents
    ? `${dependents} piece${dependents === 1 ? '' : 's'} of code in ${otherFiles} other file${otherFiles === 1 ? '' : 's'} depend on what this plan changes.`
    : 'Nothing outside the plan depends on the files it changes.');
  if (sections.length) lines.push('', ...sections);
  return {
    text: lines.join('\n'),
    dependents,
    hubs: touchedHubs,
    nodes: [...new Set(inPlan.map((n) => n.label))].slice(0, 40),
  };
}

/** Records a finished task's outcome against the map nodes it worked from. */
export async function recordMapFeedback(taskId: string, outcome: 'useful' | 'dead_end' | 'corrected', nodes: string[], correction?: string | null) {
  if (!nodes.length) return;
  await db().rpc('agentsync_map_feedback_add', {
    p_task_id: taskId,
    p_outcome: outcome,
    p_nodes: [...new Set(nodes)].slice(0, 40),
    p_correction: correction ?? null,
  });
}

/** For multi-repository routing: the code in each candidate that best matches a ticket. */
export async function codeMatches(projectId: string, ticket: string): Promise<string | null> {
  const graph = await loadCodeGraph(projectId);
  if (!graph) return null;
  const q = query(graph, ticket, { depth: 1, budget: 250 });
  if (!q.seeds.length) return null;
  return q.seeds.map((s) => `${s.label}${s.source_file ? ` (${s.source_file})` : ''}`).join('; ');
}
