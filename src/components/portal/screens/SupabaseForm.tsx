'use client';

import { useCallback, useEffect, useState } from 'react';
import { Ago, SetupSteps } from '../ui';
import SupabaseLinks from './SupabaseLinks';

/**
 * Connecting Supabase, so a change that needs a database change can have it
 * run from the merge approval instead of by hand.
 *
 * The access token is pasted once: it is checked against Supabase, then
 * stored encrypted and kept as a reference (db:…), never shown again. A
 * reference to an environment variable (env:NAME) works too.
 */

export type SupabaseConnection = {
  organization: string | null;
  projects: { ref: string; name: string; region: string | null }[];
  token_reference: string;
  connected_by_email: string | null;
  connected_at: string;
} | null;

const MESSAGES: Record<string, string> = {
  NOT_AUTHORISED: 'Your role cannot change connections for this tenant. A tenant admin can.',
  TOKEN_REQUIRED: 'Paste an access token, or give a reference such as env:SUPABASE_ACCESS_TOKEN.',
  SECRET_VALUE_NOT_A_REFERENCE: 'A reference needs a scheme, like env:SUPABASE_ACCESS_TOKEN.',
  NOT_CONNECTED: 'Supabase is not connected yet.',
  INTERNAL_ERROR: 'Could not save. Nothing was changed.',
};

/** The tenant's Supabase connection, loaded on demand (it is not part of the page's first load). */
export function useSupabaseConnection(tenantSlug: string | null) {
  const [state, setState] = useState<{ loaded: boolean; canEdit: boolean; connection: SupabaseConnection }>({
    loaded: false,
    canEdit: false,
    connection: null,
  });
  const load = useCallback(async () => {
    if (!tenantSlug) return;
    const res = await fetch(`/api/portal/connections/supabase?tenant=${encodeURIComponent(tenantSlug)}`, { cache: 'no-store' });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; can_edit?: boolean; connection?: SupabaseConnection };
    setState({ loaded: true, canEdit: Boolean(data.can_edit), connection: data.connection ?? null });
  }, [tenantSlug]);
  useEffect(() => {
    void load();
  }, [load]);
  return { ...state, reload: load };
}

const STEPS = [
  {
    title: 'Create an access token in Supabase',
    body: 'On supabase.com, open your account menu → Access tokens → Generate new token. Name it “AgentSync”. It can see the projects in your organisations.',
    href: { label: 'Open Supabase access tokens', url: 'https://supabase.com/dashboard/account/tokens' },
  },
  {
    title: 'Paste it here',
    body: 'AgentSync checks it with Supabase, then stores it encrypted. It is never shown again, and disconnecting revokes AgentSync’s copy.',
  },
  {
    title: 'Link each project to its database',
    body: 'Projects → pick a project → Settings → Database. When a change carries SQL, the merge approval then offers to run it there first.',
  },
];

export default function SupabaseForm({
  tenantSlug,
  conn,
}: {
  tenantSlug: string | null;
  conn: ReturnType<typeof useSupabaseConnection>;
}) {
  const [token, setToken] = useState('');
  const [useReference, setUseReference] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const c = conn.connection;

  async function send(method: 'POST' | 'DELETE', body: Record<string, unknown>, doing: string) {
    setBusy(doing);
    setNote(null);
    try {
      const res = await fetch('/api/portal/connections/supabase', {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenant_slug: tenantSlug, ...body }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; detail?: string; projects?: number };
      if (!res.ok) {
        setNote({ ok: false, text: data.detail ?? MESSAGES[data.error ?? ''] ?? `Could not ${doing} (${data.error ?? res.status}).` });
        return;
      }
      setToken('');
      setNote({
        ok: true,
        text: method === 'DELETE' ? 'Supabase disconnected.' : `Connected. AgentSync can see ${data.projects ?? 0} project${data.projects === 1 ? '' : 's'}.`,
      });
      await conn.reload();
    } finally {
      setBusy(null);
    }
  }

  if (!conn.loaded) return <div className="text-[14px] text-muted">Loading…</div>;

  return (
    <div className="flex flex-col gap-5">
      {c ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex h-6 items-center gap-1.5 rounded-[5px] bg-ok-tint px-2 text-[12.5px] font-medium text-ok-ink">
              <span className="size-1.5 rounded-full bg-ok" /> Connected
            </span>
            <span className="text-[14px] text-ink-2">{c.organization ?? 'Supabase'}</span>
            <span className="mono text-[12px] text-muted-3">{c.token_reference}</span>
            <span className="text-[12.5px] text-muted-3">
              by {c.connected_by_email ?? '—'}, <Ago iso={c.connected_at} />
            </span>
          </div>
          <div className="overflow-hidden rounded-[10px] border border-line-soft">
            <div className="label border-b border-line-soft px-4 py-2.5">Projects this token can reach · {c.projects.length}</div>
            <ul className="m-0 max-h-[260px] list-none overflow-y-auto p-0">
              {c.projects.map((p) => (
                <li key={p.ref} className="flex items-center gap-3 border-b border-line-faint px-4 py-2.5 last:border-b-0">
                  <span className="flex-1 text-[14px] font-medium">{p.name}</span>
                  <span className="mono text-[12px] text-muted-3">{p.ref}</span>
                  <span className="hidden text-[12.5px] text-muted-3 sm:inline">{p.region ?? ''}</span>
                </li>
              ))}
            </ul>
          </div>
          {conn.canEdit ? (
            <div className="flex flex-wrap gap-2">
              <button className="btn" disabled={!!busy} onClick={() => send('POST', { refresh: true }, 'refresh')}>
                {busy === 'refresh' ? 'Refreshing…' : 'Refresh project list'}
              </button>
              <span className="flex-1" />
              <button
                className="min-h-[38px] cursor-pointer rounded-lg px-3 text-[14px] font-medium text-danger-ink hover:bg-danger-tint disabled:opacity-50"
                disabled={!!busy}
                onClick={() => {
                  if (window.confirm('Disconnect Supabase? Database changes will have to be applied by hand until it is connected again.')) {
                    void send('DELETE', {}, 'disconnect');
                  }
                }}
              >
                Disconnect
              </button>
            </div>
          ) : null}
          {conn.canEdit ? <SupabaseLinks tenantSlug={tenantSlug} projects={c.projects} /> : null}
        </div>
      ) : (
        <SetupSteps steps={STEPS} />
      )}

      {conn.canEdit ? (
        <form
          className="flex flex-col gap-3 border-t border-line-soft pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            void send('POST', useReference ? { token_reference: token } : { token }, 'connect');
          }}
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-[13.5px] font-medium text-ink-2">
              {c ? 'Replace the token' : useReference ? 'Secret reference' : 'Supabase access token'}
            </span>
            <input
              className="field-input mono"
              type={useReference ? 'text' : 'password'}
              autoComplete="off"
              placeholder={useReference ? 'env:SUPABASE_ACCESS_TOKEN' : 'sbp_…'}
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 text-[13px] text-muted-3">
            <input type="checkbox" className="size-4 accent-[var(--color-ink)]" checked={useReference} onChange={(e) => setUseReference(e.target.checked)} />
            It lives in an environment variable instead — give its reference
          </label>
          <div>
            <button className="btn-primary" disabled={!!busy || !token.trim()}>
              {busy === 'connect' ? 'Checking with Supabase…' : c ? 'Replace token' : 'Connect Supabase'}
            </button>
          </div>
        </form>
      ) : c ? null : (
        <p className="m-0 text-[13.5px] text-muted-3">A tenant admin can connect Supabase.</p>
      )}

      {note ? <div className={`text-[13.5px] ${note.ok ? 'text-ok-ink' : 'text-danger-ink'}`}>{note.text}</div> : null}
    </div>
  );
}
