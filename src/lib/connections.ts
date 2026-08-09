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

/* ---- AI provider credentials ----------------------------------------- */

export type AiCredential = {
  tenantSlug: string;
  provider: string;
  model: string;
  keyReference: string;
  failoverTriggers: string;
  failoverRequiresOptin: boolean;
  monthlyCap: number | null;
  hardStopAtCap: boolean;
};

function unwrap(
  data: unknown,
  error: { message?: string } | null,
  label: string,
): ConnectResult {
  if (error) {
    console.error(`${label} failed`, error);
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

export async function upsertAiCredential(
  userId: string,
  input: AiCredential,
): Promise<ConnectResult> {
  const { data, error } = await serviceClient().rpc('agentsync_upsert_ai_credential', {
    payload: {
      user_id: userId,
      tenant_slug: input.tenantSlug,
      provider: input.provider,
      model: input.model,
      key_reference: input.keyReference,
      failover_triggers: input.failoverTriggers,
      failover_requires_optin: input.failoverRequiresOptin,
      monthly_cap: input.monthlyCap,
      hard_stop_at_cap: input.hardStopAtCap,
    },
  });
  return unwrap(data, error, 'upsertAiCredential');
}

export async function deleteAiCredential(
  userId: string,
  tenantSlug: string,
  provider: string,
): Promise<ConnectResult> {
  const { data, error } = await serviceClient().rpc('agentsync_delete_ai_credential', {
    p_user_id: userId,
    p_tenant_slug: tenantSlug,
    p_provider: provider,
  });
  return unwrap(data, error, 'deleteAiCredential');
}

/* ---- webhook endpoints ------------------------------------------------ */

export type WebhookEndpoint = {
  tenantSlug: string;
  direction: string;
  path: string;
  note: string;
  signingSecretRef: string;
  replayWindowSeconds: number;
  enabled: boolean;
};

export async function upsertWebhookEndpoint(
  userId: string,
  input: WebhookEndpoint,
): Promise<ConnectResult> {
  const { data, error } = await serviceClient().rpc('agentsync_upsert_webhook_endpoint', {
    payload: {
      user_id: userId,
      tenant_slug: input.tenantSlug,
      direction: input.direction,
      path: input.path,
      note: input.note,
      signing_secret_ref: input.signingSecretRef,
      replay_window_seconds: input.replayWindowSeconds,
      enabled: input.enabled,
    },
  });
  return unwrap(data, error, 'upsertWebhookEndpoint');
}

export async function deleteWebhookEndpoint(
  userId: string,
  tenantSlug: string,
  path: string,
): Promise<ConnectResult> {
  const { data, error } = await serviceClient().rpc('agentsync_delete_webhook_endpoint', {
    p_user_id: userId,
    p_tenant_slug: tenantSlug,
    p_path: path,
  });
  return unwrap(data, error, 'deleteWebhookEndpoint');
}

/* ---- secret references ------------------------------------------------ */

export type SecretReference = {
  tenantSlug: string;
  reference: string;
  usedBy: string;
  rotationDays: number;
  revoked: boolean;
  /** Only a real rotation may move rotated_at; editing the row must not. */
  markRotated: boolean;
};

export async function upsertSecretReference(
  userId: string,
  input: SecretReference,
): Promise<ConnectResult> {
  const { data, error } = await serviceClient().rpc('agentsync_upsert_secret_reference', {
    payload: {
      user_id: userId,
      tenant_slug: input.tenantSlug,
      reference: input.reference,
      used_by: input.usedBy,
      rotation_days: input.rotationDays,
      revoked: input.revoked,
      mark_rotated: input.markRotated,
    },
  });
  return unwrap(data, error, 'upsertSecretReference');
}

export async function deleteSecretReference(
  userId: string,
  tenantSlug: string,
  reference: string,
): Promise<ConnectResult> {
  const { data, error } = await serviceClient().rpc('agentsync_delete_secret_reference', {
    p_user_id: userId,
    p_tenant_slug: tenantSlug,
    p_reference: reference,
  });
  return unwrap(data, error, 'deleteSecretReference');
}
