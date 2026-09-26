'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * The Engineer's twin in Claude: a Managed Agent that runs each implementation
 * in a sandbox. Shows whether it exists yet, and creates or syncs it — each
 * sync publishes a new version of the same agent, only when the prompt changed.
 */

type State = {
  can_edit: boolean;
  credential: string;
  agent: { agent_id: string; version: number; environment_id: string; synced_at: string } | null;
};

export default function ManagedAgentCard({ tenantSlug }: { tenantSlug: string | null }) {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!tenantSlug) return;
    const res = await fetch(`/api/portal/agents/managed?tenant=${encodeURIComponent(tenantSlug)}`);
    if (res.ok) setState((await res.json()) as State);
  }, [tenantSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  async function sync() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch('/api/portal/agents/managed', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenant_slug: tenantSlug }),
      });
      const data = (await res.json().catch(() => ({}))) as State & { action?: string; error?: string; detail?: string };
      if (!res.ok) {
        setNote({ ok: false, text: data.detail ?? `Could not sync (${data.error ?? res.status}).` });
        return;
      }
      setState(data);
      setNote({
        ok: true,
        text:
          data.action === 'created'
            ? 'Created in Claude.'
            : data.action === 'updated'
              ? `Prompt changed — published version ${data.agent?.version}.`
              : 'Already up to date — nothing changed.',
      });
    } finally {
      setBusy(false);
    }
  }

  if (!state) return null;
  const a = state.agent;

  return (
    <div className="mx-4 mt-4 flex flex-col gap-3 rounded-[14px] border border-line-soft bg-agent-tint/40 p-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className={`size-2 rounded-full ${a ? 'bg-ok' : 'bg-muted-3'}`} />
        <div className="text-[14.5px] font-semibold text-ink">
          Claude Managed Agent {a ? `· version ${a.version}` : '· not created yet'}
        </div>
        <span className="text-[12.5px] text-muted-2">runs on the {state.credential}</span>
        <div className="flex-1" />
        {state.can_edit ? (
          <button className="btn-primary" onClick={sync} disabled={busy}>
            {busy ? 'Syncing…' : a ? 'Sync to Claude' : 'Create in Claude'}
          </button>
        ) : null}
      </div>
      <div className="text-[13.5px] text-ink-3" style={{ lineHeight: 1.55 }}>
        In projects set to Sandbox, each implementation runs as a session of this agent, at the task&apos;s tier.
        {a
          ? ' Syncing publishes a new version only when the Engineer prompt has changed; running tasks keep the version they started with.'
          : ' It is also created automatically by the first sandbox task.'}
      </div>
      {a ? (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-[12.5px] sm:grid-cols-3">
          <div><dt className="text-muted-2">Agent</dt><dd className="mono break-all text-ink-2">{a.agent_id}</dd></div>
          <div><dt className="text-muted-2">Environment</dt><dd className="mono break-all text-ink-2">{a.environment_id}</dd></div>
          <div><dt className="text-muted-2">Last synced</dt><dd className="mono text-ink-2">{a.synced_at.slice(0, 16).replace('T', ' ')}</dd></div>
        </dl>
      ) : null}
      {note ? <div className={`text-[13.5px] ${note.ok ? 'text-ok-ink' : 'text-danger-ink'}`}>{note.text}</div> : null}
    </div>
  );
}
