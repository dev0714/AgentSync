import 'server-only';
import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';
import { connectGithub } from './connections';
import { resolveSecret } from './secrets';
import { serviceClient } from './supabase';

/**
 * Records a one-click GitHub App as the tenant's connection.
 *
 * Everything comes from GitHub itself, authenticated as the App: that the App
 * id matches the stored key, which installation to use, and which
 * repositories it was installed on (the allowlist). Nothing is taken from the
 * browser beyond which App to finish.
 */

export type ProjectCounts = { created: number; enabled: number; disabled: number };
export type FinishResult =
  | { ok: true; projects: ProjectCounts }
  | { ok: false; error: string; detail?: string };

type RepoRef = { owner: string; name: string; default_branch: string };

/** Each installed repository is a project: create, re-enable or disable to match. */
async function syncProjects(userId: string, tenantSlug: string, repos: RepoRef[]): Promise<ProjectCounts> {
  const { data, error } = await serviceClient().rpc('agentsync_sync_github_projects', {
    p_user_id: userId,
    p_tenant_slug: tenantSlug,
    p_repos: repos,
  });
  if (error) throw error;
  const result = data as { ok: boolean; error?: string } & ProjectCounts;
  if (!result.ok) throw new Error(`project sync refused: ${result.error}`);
  return { created: result.created, enabled: result.enabled, disabled: result.disabled };
}

async function installedRepos(appId: number, privateKey: string, installationId: number): Promise<RepoRef[]> {
  const asInstall = new Octokit({
    authStrategy: createAppAuth,
    auth: { appId, privateKey, installationId },
    userAgent: 'agentsync',
  });
  const repos = await asInstall.paginate(asInstall.apps.listReposAccessibleToInstallation, {
    per_page: 100,
  });
  return repos.map((r) => ({ owner: r.owner.login, name: r.name, default_branch: r.default_branch || 'main' }));
}

export async function finishGithubConnection(params: {
  userId: string;
  tenantSlug: string;
  appSlug: string;
  appId: number;
  keyRef: string;
  installationId?: number | null;
}): Promise<FinishResult> {
  const privateKey = await resolveSecret(params.keyRef);

  const asApp = new Octokit({
    authStrategy: createAppAuth,
    auth: { appId: params.appId, privateKey },
    userAgent: 'agentsync',
  });

  // Proves the App id belongs to the stored key.
  let slug: string | undefined;
  try {
    const { data } = await asApp.apps.getAuthenticated();
    slug = data?.slug;
  } catch {
    return { ok: false, error: 'APP_ID_MISMATCH', detail: 'That App ID does not match the stored key.' };
  }
  if (slug && slug !== params.appSlug) {
    return { ok: false, error: 'APP_ID_MISMATCH', detail: `That App ID belongs to ${slug}, not ${params.appSlug}.` };
  }

  let installationId = params.installationId ?? null;
  if (!installationId) {
    const { data } = await asApp.apps.listInstallations({ per_page: 10 });
    if (data.length === 0) {
      return { ok: false, error: 'NOT_INSTALLED', detail: 'The App is not installed on any account yet.' };
    }
    installationId = data[0].id;
  }

  const repos = await installedRepos(params.appId, privateKey, installationId);
  const allowlist = repos.map((r) => `${r.owner}/${r.name}`);
  if (allowlist.length === 0) {
    return { ok: false, error: 'NO_REPOSITORIES', detail: 'The App is installed but no repository was selected.' };
  }

  const result = await connectGithub(params.userId, {
    tenantSlug: params.tenantSlug,
    appSlug: params.appSlug,
    appId: params.appId,
    installationId,
    privateKeyReference: params.keyRef,
    webhookSecretReference: '',
    repositoryAllowlist: allowlist,
    tokenTtlMinutes: 55,
    branchProtectionWrites: false,
  });
  if (!result.ok) return { ok: false, error: result.error, detail: result.detail };

  return { ok: true, projects: await syncProjects(params.userId, params.tenantSlug, repos) };
}

/**
 * Re-reads the installation's repositories from GitHub and brings the
 * allowlist and projects in line — for the "Sync from GitHub" button.
 */
export async function syncGithubProjects(userId: string, tenantSlug: string): Promise<FinishResult> {
  const { data, error } = await serviceClient().rpc('agentsync_github_connection_for_tenant', {
    p_user_id: userId,
    p_tenant_slug: tenantSlug,
  });
  if (error) throw error;
  const conn = data as { app_slug: string; app_id: number | null; installation_id: number; key_ref: string } | null;
  if (!conn) return { ok: false, error: 'NOT_CONNECTED', detail: 'Connect GitHub first.' };
  if (!conn.app_id) return { ok: false, error: 'NO_APP_ID', detail: 'The GitHub connection has no App ID.' };

  return finishGithubConnection({
    userId,
    tenantSlug,
    appSlug: conn.app_slug,
    appId: conn.app_id,
    keyRef: conn.key_ref,
    installationId: conn.installation_id,
  });
}
