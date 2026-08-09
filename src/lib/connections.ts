import 'server-only';
import { serviceClient } from './supabase';

/**
 * Writing the tenant's external connections.
 *
 * Every check that matters — who may configure this tenant, whether a
 * repository name is well formed, whether a "reference" is actually a pasted
 * secret — lives in the database function, not here. This module only shapes
 * the call, so the rules cannot be skipped by reaching the RPC another way.
 */

export type ConnectResult =
  | { ok: true }
  | { ok: false; error: string; detail?: string };

export type GithubConnection = {
  tenantSlug: string;
  appSlug: string;
  appId: number;
  installationId: number;
  privateKeyReference: string;
  webhookSecretReference: string;
  repositoryAllowlist: string[];
  tokenTtlMinutes: number;
  branchProtectionWrites: boolean;
};

export async function connectGithub(
  userId: string,
  input: GithubConnection,
): Promise<ConnectResult> {
  const { data, error } = await serviceClient().rpc('agentsync_connect_github', {
    payload: {
      user_id: userId,
      tenant_slug: input.tenantSlug,
      app_slug: input.appSlug,
      app_id: input.appId,
      installation_id: input.installationId,
      private_key_reference: input.privateKeyReference,
      webhook_secret_reference: input.webhookSecretReference,
      repository_allowlist: input.repositoryAllowlist,
      token_ttl_minutes: input.tokenTtlMinutes,
      branch_protection_writes: input.branchProtectionWrites,
    },
  });
  if (error) {
    console.error('connectGithub failed', error);
    return { ok: false, error: 'INTERNAL_ERROR' };
  }
  const result = (data ?? {}) as Record<string, unknown>;
  if (result.ok === true) return { ok: true };
  return {
    ok: false,
    error: (result.error as string) ?? 'INTERNAL_ERROR',
    detail: result.detail as string | undefined,
  };
}

export async function disconnectGithub(
  userId: string,
  tenantSlug: string,
): Promise<ConnectResult> {
  const { data, error } = await serviceClient().rpc('agentsync_disconnect_github', {
    p_user_id: userId,
    p_tenant_slug: tenantSlug,
  });
  if (error) {
    console.error('disconnectGithub failed', error);
    return { ok: false, error: 'INTERNAL_ERROR' };
  }
  const result = (data ?? {}) as Record<string, unknown>;
  if (result.ok === true) return { ok: true };
  return { ok: false, error: (result.error as string) ?? 'INTERNAL_ERROR' };
}

export type DeploymentConnection = {
  tenantSlug: string;
  provider: string;
  teamId: string;
  apiTokenReference: string;
  tokenScope: string;
  previewOn: string;
  productionTrigger: string;
  promoteViaApi: boolean;
};

export async function connectDeployment(
  userId: string,
  input: DeploymentConnection,
): Promise<ConnectResult> {
  const { data, error } = await serviceClient().rpc('agentsync_connect_deployment', {
    payload: {
      user_id: userId,
      tenant_slug: input.tenantSlug,
      provider: input.provider,
      team_id: input.teamId,
      api_token_reference: input.apiTokenReference,
      token_scope: input.tokenScope,
      preview_on: input.previewOn,
      production_trigger: input.productionTrigger,
      promote_via_api: input.promoteViaApi,
    },
  });
  if (error) {
    console.error('connectDeployment failed', error);
    return { ok: false, error: 'INTERNAL_ERROR' };
  }
  const result = (data ?? {}) as Record<string, unknown>;
  if (result.ok === true) return { ok: true };
  return {
    ok: false,
    error: (result.error as string) ?? 'INTERNAL_ERROR',
    detail: result.detail as string | undefined,
  };
}

export async function disconnectDeployment(
  userId: string,
  tenantSlug: string,
): Promise<ConnectResult> {
  const { data, error } = await serviceClient().rpc('agentsync_disconnect_deployment', {
    p_user_id: userId,
    p_tenant_slug: tenantSlug,
  });
  if (error) {
    console.error('disconnectDeployment failed', error);
    return { ok: false, error: 'INTERNAL_ERROR' };
  }
  const result = (data ?? {}) as Record<string, unknown>;
  if (result.ok === true) return { ok: true };
  return { ok: false, error: (result.error as string) ?? 'INTERNAL_ERROR' };
}
