import 'server-only';
import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';
import { connectGithub } from './connections';
import { resolveSecret } from './secrets';

/**
 * Records a one-click GitHub App as the tenant's connection.
 *
 * Everything comes from GitHub itself, authenticated as the App: that the App
 * id matches the stored key, which installation to use, and which
 * repositories it was installed on (the allowlist). Nothing is taken from the
 * browser beyond which App to finish.
 */

export type FinishResult = { ok: true } | { ok: false; error: string; detail?: string };

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

  const asInstall = new Octokit({
    authStrategy: createAppAuth,
    auth: { appId: params.appId, privateKey, installationId },
    userAgent: 'agentsync',
  });
  const repos = await asInstall.paginate(asInstall.apps.listReposAccessibleToInstallation, {
    per_page: 100,
  });
  const allowlist = repos.map((r) => r.full_name);
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
  return result.ok ? { ok: true } : { ok: false, error: result.error, detail: result.detail };
}
