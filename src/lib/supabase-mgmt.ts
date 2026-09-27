import 'server-only';

/**
 * The Supabase Management API, for the tenant's Supabase connection: which
 * projects the token can see, and running a change's SQL on one of them.
 *
 * It works with a personal access token (supabase.com → Account → Access
 * tokens) and needs no database password or direct connection — the SQL goes
 * through Supabase's own query endpoint, which runs it as the postgres role.
 */

const API = 'https://api.supabase.com/v1';

export type SupabaseProject = { ref: string; name: string; region: string | null; organization_id: string | null };

async function call(token: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
    signal: AbortSignal.timeout(90_000),
  });
}

async function errorOf(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    const j = JSON.parse(text) as { message?: string; error?: string };
    return `${res.status}: ${j.message ?? j.error ?? text}`.slice(0, 1000);
  } catch {
    return `${res.status}: ${text}`.slice(0, 1000);
  }
}

/** The projects and organisations the token can see; throws if it is refused. */
export async function inspectToken(token: string): Promise<{ projects: SupabaseProject[]; organizations: string[] }> {
  const [p, o] = await Promise.all([call(token, '/projects'), call(token, '/organizations')]);
  if (!p.ok) throw new Error(p.status === 401 ? 'Supabase refused the token (401). Check it was copied in full and has not been revoked.' : await errorOf(p));
  const projects = ((await p.json()) as { id?: string; ref?: string; name: string; region?: string; organization_id?: string }[])
    .map((x) => ({ ref: x.ref ?? x.id ?? '', name: x.name, region: x.region ?? null, organization_id: x.organization_id ?? null }))
    .filter((x) => x.ref);
  const organizations = o.ok ? ((await o.json()) as { name: string }[]).map((x) => x.name) : [];
  return { projects, organizations };
}

/** Runs a query and returns its rows, in full (runSql keeps only the start of the output). */
export async function querySql<T = Record<string, unknown>>(token: string, ref: string, sql: string): Promise<T[]> {
  const res = await call(token, `/projects/${encodeURIComponent(ref)}/database/query`, {
    method: 'POST',
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) throw new Error(await errorOf(res));
  return (await res.json()) as T[];
}

/** Runs SQL on a project, as one statement batch. */
export async function runSql(
  token: string,
  ref: string,
  sql: string,
): Promise<{ ok: true; result: string } | { ok: false; error: string }> {
  const res = await call(token, `/projects/${encodeURIComponent(ref)}/database/query`, {
    method: 'POST',
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) return { ok: false, error: await errorOf(res) };
  const body = await res.text();
  return { ok: true, result: body.slice(0, 2000) || 'OK' };
}
