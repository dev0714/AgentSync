'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * "Connect GitHub" in one click, via GitHub's App manifest flow.
 *
 * The browser POSTs a pre-filled App definition to GitHub; the person clicks
 * Create, picks repositories, and GitHub brings them back here with everything
 * recorded. No App ID to copy, no key to download or paste.
 */
export default function GithubOneClick({ tenantSlug }: { tenantSlug: string | null }) {
  const [org, setOrg] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<React.ReactNode>(null);
  const [unfinished, setUnfinished] = useState<Unfinished[]>([]);

  useEffect(() => {
    if (!tenantSlug) return;
    fetch(`/api/portal/connections/github/finish?tenant=${encodeURIComponent(tenantSlug)}`)
      .then((r) => (r.ok ? r.json() : { apps: [] }))
      .then((d: { apps: Unfinished[] }) => setUnfinished(d.apps ?? []))
      .catch(() => undefined);
  }, [tenantSlug]);

  async function start() {
    if (!tenantSlug) return;
    setBusy(true);
    setProblem(null);
    try {
      const params = new URLSearchParams({ tenant: tenantSlug });
      if (org.trim()) params.set('org', org.trim());
      const res = await fetch(`/api/portal/connections/github/manifest?${params}`);
      const data = (await res.json().catch(() => ({}))) as { error?: string; action?: string; manifest?: string };
      if (!res.ok || !data.action || !data.manifest) {
        setProblem(
          data.error === 'ENCRYPTION_NOT_CONFIGURED' ? (
            <>
              One-time setup first: add <code>AGENTSYNC_ENCRYPTION_KEY</code> to this project&apos;s
              Vercel environment variables (generate it with <code>openssl rand -base64 32</code>),
              redeploy, then click again.
            </>
          ) : data.error === 'BAD_ORG' ? (
            'That is not a valid GitHub organisation name.'
          ) : (
            `Could not start the GitHub connection (${data.error ?? res.status}).`
          ),
        );
        setBusy(false);
        return;
      }

      // GitHub's manifest flow takes a form POST, not a link.
      const form = document.createElement('form');
      form.method = 'post';
      form.action = data.action;
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = 'manifest';
      input.value = data.manifest;
      form.appendChild(input);
      document.body.appendChild(form);
      form.submit();
    } catch {
      setProblem('Could not reach the server. Try again.');
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {unfinished.map((app) => (
        <FinishConnecting key={app.key_ref} app={app} />
      ))}
      <ol className="flex flex-col gap-1.5 text-[14px] text-ink-3" style={{ lineHeight: 1.55 }}>
        <li>1. GitHub opens with the AgentSync App already filled in — click <strong>Create GitHub App</strong>.</li>
        <li>2. Choose the repositories the agents may work on, and install.</li>
        <li>3. You come straight back here, connected.</li>
      </ol>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex flex-col gap-1.5 sm:w-[280px]">
          <span className="text-[13px] font-medium text-ink-2">GitHub organisation (optional)</span>
          <input
            className="field-input mono"
            value={org}
            onChange={(e) => setOrg(e.target.value)}
            placeholder="leave blank for your account"
          />
        </label>
        <button className="btn-primary" onClick={start} disabled={busy || !tenantSlug}>
          <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
          {busy ? 'Opening GitHub…' : 'Connect GitHub'}
        </button>
      </div>
      {problem ? <div className="text-[13.5px] text-danger-ink" style={{ lineHeight: 1.55 }}>{problem}</div> : null}
      <div className="text-[12.5px] text-muted-2" style={{ lineHeight: 1.55 }}>
        The App gets read &amp; write access to code and pull requests, and read access to checks and
        Actions logs — nothing else. Its private key is stored encrypted; merges still need a person&apos;s approval here.
      </div>
    </div>
  );
}

type Unfinished = { app_slug: string; app_id: number | null; key_ref: string };

const FINISH_ERRORS: Record<string, string> = {
  APP_ID_REQUIRED: 'Enter the App ID.',
  APP_ID_MISMATCH: 'That App ID does not belong to this App.',
  NOT_INSTALLED: 'The App is not installed yet — install it on GitHub first.',
  NO_REPOSITORIES: 'The App is installed but no repository is selected on GitHub.',
  GITHUB_UNREACHABLE: 'Could not reach GitHub. Try again.',
};

/**
 * An App created through the one-click flow whose last step did not finish.
 * GitHub is asked which installation and repositories it has; older Apps also
 * need their App ID, which is checked against the stored key.
 */
function FinishConnecting({ app }: { app: Unfinished }) {
  const router = useRouter();
  const [appId, setAppId] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function finish() {
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch('/api/portal/connections/github/finish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key_ref: app.key_ref, app_id: appId ? Number(appId) : undefined }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
      if (!res.ok) {
        setProblem(FINISH_ERRORS[data.error ?? ''] ?? data.detail ?? `Could not finish (${data.error ?? res.status}).`);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-[10px] border border-[var(--color-gate-line)] bg-gate-tint p-4">
      <div className="text-[14.5px] font-semibold text-gate-ink">
        Finish connecting <span className="mono">{app.app_slug}</span>
      </div>
      <div className="text-[13.5px] text-ink-3" style={{ lineHeight: 1.55 }}>
        This App was created and its key is stored, but the connection was not recorded.
        {app.app_id ? ' Finish it here — no need to create another App.' : (
          <>
            {' '}Enter its <strong>App ID</strong> — the number near the top of{' '}
            <a href={`https://github.com/settings/apps/${app.app_slug}`} target="_blank" rel="noreferrer noopener">
              the App&apos;s settings page
            </a>{' '}
            (for an organisation App, under the organisation&apos;s Developer settings).
          </>
        )}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        {app.app_id ? null : (
          <input
            className="field-input mono sm:w-[200px]"
            inputMode="numeric"
            placeholder="App ID, e.g. 1234567"
            value={appId}
            onChange={(e) => setAppId(e.target.value.replace(/\D/g, ''))}
          />
        )}
        <button className="btn-gate" onClick={finish} disabled={busy || (!app.app_id && !appId)}>
          {busy ? 'Finishing…' : 'Finish connecting'}
        </button>
      </div>
      {problem ? <div className="text-[13.5px] text-danger-ink">{problem}</div> : null}
    </div>
  );
}
