'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Recording the GitHub App installation, from the browser.
 *
 * The private key and the webhook secret are deliberately *not* fields here.
 * Those live in the deployment environment; what this form stores is a
 * reference to them, so the row can be read back into a web page without ever
 * carrying a credential. The database refuses a reference that looks like a
 * pasted key, so this is enforced rather than merely asked for.
 */

const MESSAGES: Record<string, string> = {
  NOT_AUTHORISED:
    'Your role cannot change connections for this tenant. A tenant admin can.',
  NO_SUCH_TENANT: 'That tenant no longer exists.',
  APP_SLUG_REQUIRED: 'The app slug is required.',
  APP_ID_REQUIRED: 'The App ID is required — the number on the App\u2019s settings page.',
  APP_ID_EQUALS_INSTALLATION_ID:
    'The App ID and the installation id are different numbers. The App ID is on the App\u2019s settings page; the installation id is in the install URL.',
  INSTALLATION_ID_REQUIRED: 'The installation id must be the number from the install URL.',
  SECRET_REFERENCE_REQUIRED: 'The private key reference is required.',
  SECRET_VALUE_NOT_A_REFERENCE:
    'That looks like the secret itself. Store the key in your environment and put its name here, for example env:GITHUB_APP_PRIVATE_KEY.',
  TOKEN_TTL_OUT_OF_RANGE: 'Token lifetime must be between 5 and 60 minutes.',
  REPOSITORY_REQUIRED: 'List at least one repository the agent may touch.',
  BAD_REPOSITORY: 'Repositories must be written as owner/repository.',
  INTERNAL_ERROR: 'Could not save. Nothing was changed.',
};

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

export default function GithubForm({
  tenantSlug,
  existing,
}: {
  tenantSlug: string | null;
  existing: Record<string, unknown> | null;
}) {
  const router = useRouter();
  const [appSlug, setAppSlug] = useState(String(existing?.app_slug ?? ''));
  const [appId, setAppId] = useState(
    existing?.app_id ? String(existing.app_id) : '',
  );
  const [installationId, setInstallationId] = useState(
    existing?.installation_id ? String(existing.installation_id) : '',
  );
  const [keyRef, setKeyRef] = useState(
    String(existing?.private_key_reference ?? 'env:GITHUB_APP_PRIVATE_KEY'),
  );
  const [hookRef, setHookRef] = useState(
    String(existing?.webhook_secret_reference ?? ''),
  );
  const [repos, setRepos] = useState(
    ((existing?.repository_allowlist as string[] | undefined) ?? []).join('\n'),
  );
  const [ttl, setTtl] = useState(String(existing?.token_ttl_minutes ?? 55));
  const [protectedWrites, setProtectedWrites] = useState(
    Boolean(existing?.branch_protection_writes),
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!tenantSlug) return;
    setBusy(true);
    setError(null);

    const response = await fetch('/api/portal/connections/github', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_slug: tenantSlug,
        app_slug: appSlug,
        app_id: Number(appId),
        installation_id: Number(installationId),
        private_key_reference: keyRef,
        webhook_secret_reference: hookRef,
        repository_allowlist: repos
          .split('\n')
          .map((r) => r.trim())
          .filter(Boolean),
        token_ttl_minutes: Number(ttl),
        branch_protection_writes: protectedWrites,
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

    // The overview is server-rendered, so re-fetch it rather than patching
    // client state — the screen then shows what the database actually holds.
    router.refresh();
  }

  async function disconnect() {
    if (!tenantSlug) return;
    setBusy(true);
    setError(null);
    const response = await fetch(
      `/api/portal/connections/github?tenant=${encodeURIComponent(tenantSlug)}`,
      { method: 'DELETE' },
    ).catch(() => null);
    setBusy(false);
    if (!response?.ok) return setError(MESSAGES.INTERNAL_ERROR);
    router.refresh();
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Field
          label="app_slug"
          hint="The URL form of the name, not the display name: github.com/apps/<slug>. “Agent sync” becomes agent-sync."
        >
          <input
            className="field-input"
            value={appSlug}
            onChange={(e) => setAppSlug(e.target.value)}
            placeholder="agent-sync"
            required
          />
        </Field>
        <Field
          label="app_id"
          hint="App ID on the App’s settings page. This is what signs the JWT that mints an installation token — not the slug, and not the installation id."
        >
          <input
            className="field-input"
            value={appId}
            onChange={(e) => setAppId(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric"
            placeholder="1234567"
            required
          />
        </Field>
        <Field
          label="installation_id"
          hint="The number the install URL ends in: …/installations/12345678."
        >
          <input
            className="field-input"
            value={installationId}
            onChange={(e) => setInstallationId(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric"
            placeholder="12345678"
            required
          />
        </Field>
        <Field
          label="private_key_reference"
          hint="The name of the environment variable holding the .pem — not the key."
        >
          <input
            className="field-input"
            value={keyRef}
            onChange={(e) => setKeyRef(e.target.value)}
            required
          />
        </Field>
        <Field
          label="webhook_secret_reference"
          hint="Optional. Leave empty while the App's webhook is switched off — nothing here receives GitHub events yet, so there is no secret to name."
        >
          <input
            className="field-input"
            value={hookRef}
            onChange={(e) => setHookRef(e.target.value)}
            placeholder="env:GITHUB_WEBHOOK_SECRET"
          />
        </Field>
      </div>

      <Field
        label="repository_allowlist"
        hint="One owner/repository per line. This is the outer bound on what any agent can reach — nothing outside it is checked out, read or written."
      >
        <textarea
          className="field-input min-h-[76px] resize-y"
          value={repos}
          onChange={(e) => setRepos(e.target.value)}
          placeholder={'dev0714/AgentSync'}
          required
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Field
          label="token_ttl_minutes"
          hint="How long a minted installation token stays valid. 5–60."
        >
          <input
            className="field-input"
            value={ttl}
            onChange={(e) => setTtl(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric"
          />
        </Field>
        <Field
          label="branch_protection_writes"
          hint="Leave false. True lets the agent push to a protected branch, which defeats the merge gate."
        >
          <select
            className="field-select"
            value={String(protectedWrites)}
            onChange={(e) => setProtectedWrites(e.target.value === 'true')}
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
          {busy ? 'Saving…' : existing ? 'Save changes' : 'Connect GitHub'}
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
