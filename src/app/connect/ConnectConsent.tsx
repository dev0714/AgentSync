'use client';

import { useState } from 'react';
import { Logo } from '@/components/site/Icon';

const ERRORS: Record<string, string> = {
  NOT_AUTHORISED: 'Only an admin of that tenant can connect a source to it.',
  ENCRYPTION_NOT_CONFIGURED: 'This AgentSync deployment has no AGENTSYNC_ENCRYPTION_KEY set, so it cannot store the connection.',
  BAD_REQUEST: 'The connection link is incomplete. Start again from the other app.',
};

export default function ConnectConsent(props: {
  valid: boolean;
  app: string;
  account: string;
  returnUrl: string;
  returnHost: string;
  state: string;
  challenge: string;
  tenants: { slug: string; name: string }[];
  userEmail: string;
}) {
  const { valid, app, account, returnUrl, returnHost, state, challenge, tenants, userEmail } = props;
  const [tenant, setTenant] = useState(tenants[0]?.slug ?? '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function approve() {
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch('/api/portal/connect/approve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenant_slug: tenant, app, account, return_url: returnUrl, state, challenge }),
      });
      const body = (await res.json().catch(() => ({}))) as { redirect?: string; error?: string };
      if (!res.ok || !body.redirect) {
        setProblem(ERRORS[body.error ?? ''] ?? `Could not connect (${body.error ?? res.status}).`);
        setBusy(false);
        return;
      }
      window.location.assign(body.redirect);
    } catch {
      setProblem('Could not reach AgentSync.');
      setBusy(false);
    }
  }

  function cancel() {
    const url = new URL(returnUrl);
    url.searchParams.set('error', 'access_denied');
    url.searchParams.set('state', state);
    window.location.assign(url.toString());
  }

  const label = account ? `${app} · ${account}` : app;

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10 text-ink sm:px-6">
      <div className="fade-up card flex w-full max-w-[480px] flex-col gap-6 p-5 sm:p-7">
        <Logo size={24} decorative />
        {!valid ? (
          <>
            <h1 className="display m-0 text-[26px] font-bold tracking-[-0.02em]">This link doesn&apos;t work</h1>
            <p className="m-0 text-[15px] leading-[1.55] text-ink-3">
              The connection link is incomplete or has been changed. Go back to the app you came from and click Connect
              AgentSync again.
            </p>
          </>
        ) : tenants.length === 0 ? (
          <>
            <h1 className="display m-0 text-[26px] font-bold tracking-[-0.02em]">No tenant to connect</h1>
            <p className="m-0 text-[15px] leading-[1.55] text-ink-3">
              {userEmail} isn&apos;t an admin of any AgentSync tenant. Ask a tenant admin to connect {app}, or to make you an
              admin.
            </p>
            <button className="btn" onClick={cancel}>Back to {app}</button>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <h1 className="display m-0 text-[24px] leading-[1.15] font-bold tracking-[-0.02em] break-words sm:text-[26px]">
                Connect {label}
              </h1>
              <p className="m-0 text-[15px] leading-[1.55] text-ink-3">
                {app} wants to send its tickets to AgentSync as a source system. It will be able to:
              </p>
            </div>
            <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[14.5px] leading-[1.5]">
              <li className="flex gap-2.5"><span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-ink" />Submit tasks, which still wait for your plan and merge approvals</li>
              <li className="flex gap-2.5"><span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-ink" />Send its client list, which you map to repositories here</li>
              <li className="flex gap-2.5"><span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-ink" />Receive signed progress updates on the tasks it sent</li>
            </ul>

            <label className="flex flex-col gap-2">
              <span className="text-[14px] font-semibold">AgentSync tenant</span>
              <select className="field-input min-h-[48px]" value={tenant} onChange={(e) => setTenant(e.target.value)}>
                {tenants.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}
              </select>
            </label>

            <div className="rounded-xl border border-line bg-raised px-3.5 py-3 text-[13.5px] leading-[1.5] text-ink-3">
              You&apos;ll be sent back to <span className="mono font-semibold text-ink">{returnHost}</span>. Only approve if
              that is the {app} you use. Connecting again later replaces the key and keeps your client mappings.
            </div>

            {problem ? (
              <div role="alert" className="rounded-xl border border-[#e7b8b2] bg-danger-tint px-3.5 py-3 text-[14px] leading-[1.5] text-danger-ink">
                {problem}
              </div>
            ) : null}

            <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
              <button className="btn" onClick={cancel} disabled={busy}>Cancel</button>
              <button className="btn-primary" onClick={approve} disabled={busy || !tenant}>
                {busy ? 'Connecting…' : `Connect ${app}`}
              </button>
            </div>
            <p className="m-0 text-[12.5px] text-muted-2">Signed in as {userEmail}.</p>
          </>
        )}
      </div>
    </main>
  );
}
