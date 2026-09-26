import 'server-only';
import { Sandbox } from '@vercel/sandbox';
import { installationToken, type Installation } from './github';
import { serviceClient } from './supabase';

/**
 * A map of each project's code, made with Graphify (https://github.com/Graphify-Labs/graphify).
 *
 * Code-only: Graphify parses the repository with tree-sitter — no AI model, no
 * API key, nothing sent anywhere but the sandbox. Each run happens in a Vercel
 * Sandbox that clones the repository with a short-lived GitHub App token:
 *
 *   queued ─► running (sandbox started, Graphify detached) ─► ready | failed
 *
 * The worker's tick starts queued runs (a few at a time) and polls running
 * ones; a finished run's graph.json, graph.html and GRAPH_REPORT.md go to the
 * private project-maps bucket, with Graphify's cache so the next run only
 * re-parses what changed. Maps are made when a project is first imported,
 * after every merge, and on request.
 */

export const GRAPHIFY_VERSION = '0.9.69';
export const MAP_BUCKET = 'project-maps';
const CONCURRENCY = Number(process.env.AGENTSYNC_MAP_CONCURRENCY ?? 2);
const RUN_LIMIT_MS = 30 * 60_000;
const OUT = '/tmp/agentsync';
const MAX_FILE_BYTES = 95 * 1024 * 1024;

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
// Verified against graphifyy 0.9.69: `extract --code-only` parses the code
// (tree-sitter, [sql] adds SQL) and writes graph.json; `cluster-only` writes
// GRAPH_REPORT.md and graph.html. With no AI key and no `claude` CLI in the
// sandbox, subsystems are named after their most-connected item — no model is
// called and the report shows a token cost of 0. `env -i` makes sure of it.
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
    "$RUNPY" -m pip install --quiet --disable-pip-version-check "graphifyy[sql]==${GRAPHIFY_VERSION}"
  else
    rm -rf /tmp/graphify-venv
    if ! "$PY" -m pip --version >/dev/null 2>&1; then
      curl -sSfL https://bootstrap.pypa.io/get-pip.py -o /tmp/get-pip.py &&
      PIP_BREAK_SYSTEM_PACKAGES=1 "$PY" /tmp/get-pip.py --quiet --user
    fi &&
    PIP_BREAK_SYSTEM_PACKAGES=1 "$PY" -m pip install --quiet --disable-pip-version-check --target /tmp/graphify-lib "graphifyy[sql]==${GRAPHIFY_VERSION}" &&
    RUNPY="$PY"
  fi &&
  if [ -f ${OUT}/cache.in.tgz ]; then tar -xzf ${OUT}/cache.in.tgz; fi &&
  UPDATE="" && if [ -f graphify-out/manifest.json ] && [ -f graphify-out/graph.json ]; then UPDATE="--update"; fi &&
  env -i HOME=/tmp PATH=/usr/local/bin:/usr/bin:/bin PYTHONPATH=/tmp/graphify-lib "$RUNPY" -m graphify extract . --code-only $UPDATE &&
  env -i HOME=/tmp PATH=/usr/local/bin:/usr/bin:/bin PYTHONPATH=/tmp/graphify-lib "$RUNPY" -m graphify cluster-only .
} > ${OUT}/log.txt 2>&1
code=$?
git rev-parse HEAD > ${OUT}/commit.txt 2>/dev/null
if [ $code -eq 0 ]; then
  tar -czf ${OUT}/cache.tgz graphify-out/cache graphify-out/manifest.json graphify-out/graph.json 2>/dev/null || true
fi
echo $code > ${OUT}/exit.txt
`;

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

    // The previous run's cache, so this run only re-parses what changed.
    if (row.files?.['cache.tgz']) {
      const { data: cache } = await db().storage.from(MAP_BUCKET).download(`${row.project_id}/cache.tgz`);
      if (cache) {
        await sandbox.runCommand({ cmd: 'mkdir', args: ['-p', OUT] });
        await sandbox.writeFiles([{ path: `${OUT}/cache.in.tgz`, content: Buffer.from(await cache.arrayBuffer()) }]);
      }
    }
    await sandbox.runCommand({ cmd: 'bash', args: ['-c', SCRIPT], detached: true });
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

  const outputs: [string, string, string][] = [
    ['graph.json', '/vercel/sandbox/graphify-out/graph.json', 'application/json'],
    ['graph.html', '/vercel/sandbox/graphify-out/graph.html', 'text/html'],
    ['GRAPH_REPORT.md', '/vercel/sandbox/graphify-out/GRAPH_REPORT.md', 'text/markdown'],
    ['cache.tgz', `${OUT}/cache.tgz`, 'application/gzip'],
  ];
  const files: Record<string, number> = {};
  let stats: Record<string, number> | null = null;
  for (const [key, path, type] of outputs) {
    const buf = await read(path);
    if (!buf || buf.length > MAX_FILE_BYTES) continue;
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

/* ---- for the agents ------------------------------------------------------ */

type Node = { id: string; label: string; file: string | null };

/**
 * What the Analyst and Planner get from the map: the report, and the
 * connections around the files a request touches.
 */
export async function mapContext(projectId: string, relevantPaths: string[]): Promise<string | null> {
  const { data } = await db().rpc('agentsync_map_get', { p_project_id: projectId });
  const map = data as { files?: Record<string, number> | null; commit_sha?: string | null } | null;
  if (!map?.files) return null;
  const parts: string[] = [];

  if (map.files['GRAPH_REPORT.md']) {
    const { data: report } = await db().storage.from(MAP_BUCKET).download(`${projectId}/GRAPH_REPORT.md`);
    if (report) parts.push(`## Code map report (Graphify, commit ${map.commit_sha?.slice(0, 7) ?? '?'})\n\n${(await report.text()).slice(0, 8000)}`);
  }

  if (map.files['graph.json'] && relevantPaths.length && map.files['graph.json'] < 60 * 1024 * 1024) {
    const { data: raw } = await db().storage.from(MAP_BUCKET).download(`${projectId}/graph.json`);
    if (raw) {
      try {
        const graph = JSON.parse(await raw.text()) as Graph;
        const nodes = new Map<string, Node>();
        for (const n of (graph.nodes ?? []) as Record<string, unknown>[]) {
          const id = String(n.id ?? '');
          if (!id) continue;
          const file = (n.source_file ?? n.file ?? n.path ?? null) as string | null;
          nodes.set(id, { id, label: String(n.label ?? n.name ?? id), file });
        }
        const wanted = new Set(relevantPaths.map((p) => p.replace(/^\.\//, '')));
        const touches = (n: Node | undefined) => Boolean(n?.file && [...wanted].some((p) => n.file!.endsWith(p)));
        const lines: string[] = [];
        for (const e of ((graph.links ?? graph.edges ?? []) as Record<string, unknown>[])) {
          const s = nodes.get(String(typeof e.source === 'object' ? (e.source as { id?: unknown })?.id : e.source));
          const t = nodes.get(String(typeof e.target === 'object' ? (e.target as { id?: unknown })?.id : e.target));
          if (!s || !t || !(touches(s) || touches(t))) continue;
          const rel = String(e.relation ?? e.type ?? e.label ?? 'relates to');
          lines.push(`- ${s.label}${s.file ? ` (${s.file})` : ''} —${rel}→ ${t.label}${t.file ? ` (${t.file})` : ''}`);
          if (lines.length >= 120) break;
        }
        if (lines.length) parts.push(`## Connections around the files this request touches\n\n${lines.join('\n')}`);
      } catch {
        // a map we can't read is no map
      }
    }
  }
  return parts.length ? parts.join('\n\n') : null;
}
