'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Recording the deployment provider, from the browser.
 *
 * As with GitHub, the API token is not a field — only the name of the
 * environment variable holding it. A Vercel token is an unremarkable
 * 24-character string, so "that is a reference, not a secret" is checked in the
 * database rather than assumed: a value with no scheme is refused.
 */

const MESSAGES: Record<string, string> = {
  NOT_AUTHORISED:
    'Your role cannot change connections for this tenant. A tenant admin can.',
  NO_SUCH_TENANT: 'That tenant no longer exists.',
  UNSUPPORTED_PROVIDER: 'That provider is not supported yet.',
  SECRET_VALUE_NOT_A_REFERENCE:
    'That looks like the token itself. Store it in your environment and put its name here, with a scheme — env:VERCEL_API_TOKEN.',
  TOKEN_SCOPE_REQUIRED:
    'Say what this token is allowed to do. It is recorded so a reviewer can see the blast radius without going to the provider.',
  BAD_PREVIEW_TRIGGER: 'Choose when a preview is built.',
  BAD_PRODUCTION_TRIGGER: 'Choose what promotes a build to production.',
  PROMOTION_CONTRADICTION:
    'Promoting through the provider API while production is triggered manually contradicts itself. Pick one.',
  INTERNAL_ERROR: 'Could not save. Nothing was changed.',
};

const PROVIDERS = [
  { value: 'vercel', label: 'Vercel' },
  { value: 'netlify', label: 'Netlify' },
  { value: 'cloudflare_pages', label: 'Cloudflare Pages' },
  { value: 'render', label: 'Render' },
];

const PREVIEW_ON = [
  { value: 'pull_request', label: 'pull_request — once the PR opens' },
  { value: 'branch_push', label: 'branch_push — every push to the task branch' },
  { value: 'never', label: 'never — skip previews' },
];

const PRODUCTION_TRIGGER = [
  { value: 'merge', label: 'merge — the provider builds on merge to default' },
  { value: 'approval', label: 'approval — held until a human approves in AgentSync' },
  { value: 'manual', label: 'manual — never automatic' },
];

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="mono text-[11px] text-muted-2">{label}</span>
      {children}
      {hint ? (
        <span className="text-[11px] text-muted-3" style={{ lineHeight: 1.5 }}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}

export default function DeploymentForm({
  tenantSlug,
  existing,
}: {
  tenantSlug: string | null;
  existing: Record<string, unknown> | null;
}) {
  const router = useRouter();
  const [provider, setProvider] = useState(String(existing?.provider ?? 'vercel'));
  const [teamId, setTeamId] = useState(String(existing?.team_id ?? ''));
  const [tokenRef, setTokenRef] = useState(
    String(existing?.api_token_reference ?? 'env:VERCEL_API_TOKEN'),
  );
  const [scope, setScope] = useState(String(existing?.token_scope ?? ''));
  const [previewOn, setPreviewOn] = useState(
    String(existing?.preview_on ?? 'pull_request'),
  );
  const [productionTrigger, setProductionTrigger] = useState(
    String(existing?.production_trigger ?? 'merge'),
  );
  const [promoteViaApi, setPromoteViaApi] = useState(
    Boolean(existing?.promote_via_api),
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!tenantSlug) return;
    setBusy(true);
    setError(null);

    const response = await fetch('/api/portal/connections/deployment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_slug: tenantSlug,
        provider,
        team_id: teamId,
        api_token_reference: tokenRef,
        token_scope: scope,
        preview_on: previewOn,
        production_trigger: productionTrigger,
        promote_via_api: promoteViaApi,
      }),
    }).catch(() => null);

    setBusy(false);
    if (!response) return setError(MESSAGES.INTERNAL_ERROR);

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        detail?: string;
      };
      const message = MESSAGES[body.error ?? ''] ?? MESSAGES.INTERNAL_ERROR;
      return setError(body.detail ? `${message} (${body.detail})` : message);
    }

    router.refresh();
  }

  async function disconnect() {
    if (!tenantSlug) return;
    setBusy(true);
    setError(null);
    const response = await fetch(
      `/api/portal/connections/deployment?tenant=${encodeURIComponent(tenantSlug)}`,
      { method: 'DELETE' },
    ).catch(() => null);
    setBusy(false);
    if (!response?.ok) return setError(MESSAGES.INTERNAL_ERROR);
    router.refresh();
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Field label="provider" hint="Vercel is the one these instructions cover.">
          <select
            className="field-select"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          >
            {PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="team_id"
          hint="Vercel → Team Settings → General. Leave empty for a personal account."
        >
          <input
            className="field-input"
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            placeholder="team_xxxxxxxxxxxx"
          />
        </Field>

        <Field
          label="api_token_reference"
          hint="The name of the environment variable holding the token, with a scheme. The token itself is refused."
        >
          <input
            className="field-input"
            value={tokenRef}
            onChange={(e) => setTokenRef(e.target.value)}
            required
          />
        </Field>
      </div>

      <Field
        label="token_scope"
        hint="What this token may do, in your own words. Recorded so a reviewer can judge the blast radius without logging in to the provider."
      >
        <input
          className="field-input"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          placeholder="Read and deploy, AgentSync project only"
          required
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Field label="preview_on" hint="When a preview build is created.">
          <select
            className="field-select"
            value={previewOn}
            onChange={(e) => setPreviewOn(e.target.value)}
          >
            {PREVIEW_ON.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="production_trigger"
          hint="What promotes a build to production. 'approval' is what keeps the production gate meaningful."
        >
          <select
            className="field-select"
            value={productionTrigger}
            onChange={(e) => setProductionTrigger(e.target.value)}
          >
            {PRODUCTION_TRIGGER.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="promote_via_api"
          hint="true: AgentSync calls the provider to promote. false: the provider's own git integration decides."
        >
          <select
            className="field-select"
            value={String(promoteViaApi)}
            onChange={(e) => setPromoteViaApi(e.target.value === 'true')}
          >
            <option value="false">false</option>
            <option value="true">true</option>
          </select>
        </Field>
      </div>

      {error ? (
        <div
          className="rounded-lg border px-3.5 py-2.5 text-[12.5px] text-danger"
          style={{ borderColor: '#452020', background: '#1A0F0E', lineHeight: 1.5 }}
          role="alert"
        >
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-primary" disabled={busy || !tenantSlug}>
          {busy ? 'Saving…' : existing ? 'Save changes' : 'Connect provider'}
        </button>
        {existing ? (
          <button
            type="button"
            className="btn-danger"
            onClick={disconnect}
            disabled={busy}
          >
            Disconnect
          </button>
        ) : null}
      </div>
    </form>
  );
}
