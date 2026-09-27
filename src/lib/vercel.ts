import 'server-only';
import { resolveSecret } from './secrets';
import { serviceClient } from './supabase';

/**
 * Reading deployments from Vercel, for the Deployments screen. Vercel builds
 * each push by itself (previews for branches, production for the default
 * branch); AgentSync only reads what it did — with a token, for the team or
 * teams it can see — and keeps the deployments of repositories its projects
 * use, matched to the task by commit or branch.
 */

const API = 'https://api.vercel.com';

async function call<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let message = text;
    try {
      message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? text;
    } catch {
      /* not JSON */
    }
    throw new Error(res.status === 401 || res.status === 403
      ? `Vercel refused the token (${res.status}). Check it was copied in full and has not expired.`
      : `Vercel ${res.status}: ${message.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

/** Who the token belongs to and the teams it can read; throws when refused. */
export async function inspectVercelToken(token: string): Promise<{ user: string; teams: { id: string; name: string }[] }> {
  const me = await call<{ user?: { username?: string; email?: string } }>(token, '/v2/user');
  const teams = await call<{ teams?: { id: string; name?: string; slug?: string }[] }>(token, '/v2/teams?limit=100')
    .catch(() => ({ teams: [] as { id: string; name?: string; slug?: string }[] }));
  return {
    user: me.user?.username ?? 'Vercel user',
    teams: (teams.teams ?? []).map((t) => ({ id: t.id, name: t.name ?? t.slug ?? t.id })),
  };
}

type VercelDeployment = {
  uid: string;
  url?: string | null;
  created?: number;
  createdAt?: number;
  buildingAt?: number;
  ready?: number;
  state?: string;
  readyState?: string;
  target?: string | null;
  meta?: Record<string, string | undefined>;
};

const STATUS: Record<string, string> = {
  QUEUED: 'QUEUED',
  INITIALIZING: 'BUILDING',
  BUILDING: 'BUILDING',
  READY: 'READY',
  ERROR: 'ERROR',
  CANCELED: 'CANCELLED',
  CANCELLED: 'CANCELLED',
};

export type DeploymentRecord = {
  provider: 'vercel';
  external_id: string;
  environment: 'production' | 'preview';
  status: string;
  url: string | null;
  org: string;
  repo: string;
  sha: string | null;
  ref: string | null;
  started_at: string;
  finished_at: string | null;
  build_seconds: number | null;
};

/** One Vercel deployment as AgentSync records it; null when it wasn't built from GitHub. */
export function toRecord(d: VercelDeployment): DeploymentRecord | null {
  const m = d.meta ?? {};
  const org = m.githubCommitOrg ?? m.githubOrg;
  const repo = m.githubCommitRepo ?? m.githubRepo;
  if (!org || !repo) return null;
  const state = (d.readyState ?? d.state ?? 'QUEUED').toUpperCase();
  const created = d.createdAt ?? d.created ?? Date.now();
  const done = ['READY', 'ERROR', 'CANCELED', 'CANCELLED'].includes(state) && d.ready ? d.ready : null;
  return {
    provider: 'vercel',
    external_id: d.uid,
    environment: d.target === 'production' ? 'production' : 'preview',
    status: STATUS[state] ?? 'QUEUED',
    url: d.url ? `https://${d.url.replace(/^https?:\/\//, '')}` : null,
    org,
    repo,
    sha: m.githubCommitSha ?? null,
    ref: m.githubCommitRef ?? null,
    started_at: new Date(created).toISOString(),
    finished_at: done ? new Date(done).toISOString() : null,
    build_seconds: done ? Math.max(0, Math.round((done - (d.buildingAt ?? created)) / 1000)) : null,
  };
}

/** The last 30 days of deployments for one scope (a team, or the token's own account). */
async function listDeployments(token: string, teamId: string | null): Promise<VercelDeployment[]> {
  const since = Date.now() - 30 * 24 * 3600 * 1000;
  const out: VercelDeployment[] = [];
  let until: number | null = null;
  for (let page = 0; page < 5; page++) {
    const q = new URLSearchParams({ limit: '100', since: String(since) });
    if (teamId) q.set('teamId', teamId);
    if (until) q.set('until', String(until));
    const r: { deployments?: VercelDeployment[]; pagination?: { next?: number | null } } = await call(token, `/v6/deployments?${q}`);
    out.push(...(r.deployments ?? []));
    if (!r.pagination?.next) break;
    until = r.pagination.next;
  }
  return out;
}

type SyncConfig = {
  ok: boolean;
  error?: string;
  tenant_id?: string;
  connected?: boolean;
  provider?: string | null;
  team_id?: string | null;
  token_reference?: string | null;
  last_synced_at?: string | null;
  last_sync_error?: string | null;
  repositories?: string[];
};

export type SyncState = { connected: boolean; provider: string | null; last_synced_at: string | null; error: string | null };

/**
 * Brings the tenant's deployments up to date from Vercel, at most once a
 * minute unless forced. Never throws: a failure is recorded and shown.
 */
export async function syncDeployments(userId: string, tenantSlug: string, force = false): Promise<SyncState | { error: string; denied: true }> {
  const db = serviceClient();
  const { data } = await db.rpc('agentsync_deployment_sync_config', { p_user_id: userId, p_tenant_slug: tenantSlug });
  const cfg = (data ?? { ok: false }) as SyncConfig;
  if (!cfg.ok || !cfg.tenant_id) return { error: cfg.error ?? 'NOT_AUTHORISED', denied: true };
  const state = (): SyncState => ({
    connected: !!cfg.connected,
    provider: cfg.provider ?? null,
    last_synced_at: cfg.last_synced_at ?? null,
    error: cfg.last_sync_error ?? null,
  });
  if (!cfg.connected || !cfg.token_reference) return state();
  if (cfg.provider !== 'vercel') return { ...state(), error: `Reading deployments from ${cfg.provider} is not supported yet; Vercel is.` };
  const fresh = cfg.last_synced_at && Date.now() - Date.parse(cfg.last_synced_at) < 60_000;
  if (fresh && !force) return state();

  let rows: DeploymentRecord[] = [];
  let error: string | null = null;
  try {
    const token = await resolveSecret(cfg.token_reference);
    const scopes = cfg.team_id ? [cfg.team_id] : [null, ...(await inspectVercelToken(token)).teams.map((t) => t.id)];
    const repos = new Set((cfg.repositories ?? []).map((r) => r.toLowerCase()));
    const seen = new Set<string>();
    for (const scope of scopes) {
      for (const d of await listDeployments(token, scope)) {
        const rec = toRecord(d);
        if (!rec || seen.has(rec.external_id) || !repos.has(`${rec.org}/${rec.repo}`.toLowerCase())) continue;
        seen.add(rec.external_id);
        rows.push(rec);
      }
    }
  } catch (e) {
    error = (e as Error).message;
    rows = [];
  }
  await db.rpc('agentsync_deployments_record', { p_tenant_id: cfg.tenant_id, p_rows: rows, p_error: error });
  return { connected: true, provider: cfg.provider ?? 'vercel', last_synced_at: new Date().toISOString(), error };
}
