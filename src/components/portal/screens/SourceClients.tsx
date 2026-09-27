'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Ago, CopyBlock } from '../ui';

/**
 * A source system's clients, each mapped to the repositories its requests are
 * built in. A service desk sends the client with every ticket; AgentSync
 * routes it to the client's repository — when there are several, a small
 * model picks one using each mapping's hint — and refuses it
 * (CLIENT_NOT_MAPPED) until a person maps at least one here.
 */

type Mapping = { project_id: string; hint: string | null };
type Client = {
  external_id: string;
  name: string;
  projects: Mapping[];
  active: boolean;
  last_seen_at: string;
  task_count: number;
};
type ProjectOption = { id: string; name: string; enabled: boolean };
type Loaded = { clients: Client[]; projects: ProjectOption[]; has_callback_secret: boolean };

const ERRORS: Record<string, string> = {
  NOT_AUTHORISED: 'Only a tenant admin can change this.',
  PROJECT_NOT_FOUND: 'That project is not in this tenant.',
  CLIENT_NOT_FOUND: 'That client is no longer listed.',
  ENCRYPTION_NOT_CONFIGURED: 'Set AGENTSYNC_ENCRYPTION_KEY in Vercel first.',
};

export default function SourceClients({ sourceId, sourceName, tenantSlug }: {
  sourceId: string;
  sourceName: string;
  tenantSlug: string | null;
}) {
  const [data, setData] = useState<Loaded | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [onlyUnmapped, setOnlyUnmapped] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);

  const load = useCallback(async () => {
    setProblem(null);
    const res = await fetch(`/api/portal/sources/${sourceId}/clients?tenant=${encodeURIComponent(tenantSlug ?? '')}`, { cache: 'no-store' });
    const body = (await res.json().catch(() => ({}))) as Loaded & { error?: string };
    if (!res.ok) {
      setProblem(ERRORS[body.error ?? ''] ?? `Could not load clients (${body.error ?? res.status}).`);
      return;
    }
    setData(body);
  }, [sourceId, tenantSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  // Saves a client's whole repository list (with hints); an empty list unmaps it.
  async function save(client: Client, projects: Mapping[]) {
    setSaving(client.external_id);
    setProblem(null);
    const before = client.projects;
    setData((d) => d && {
      ...d,
      clients: d.clients.map((c) => (c.external_id === client.external_id ? { ...c, projects } : c)),
    });
    try {
      const res = await fetch(`/api/portal/sources/${sourceId}/clients`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenant_slug: tenantSlug, external_id: client.external_id, projects }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setProblem(ERRORS[body.error ?? ''] ?? `Could not save (${body.error ?? res.status}).`);
        setData((d) => d && {
          ...d,
          clients: d.clients.map((c) => (c.external_id === client.external_id ? { ...c, projects: before } : c)),
        });
      }
    } finally {
      setSaving(null);
    }
  }

  async function rotate() {
    if (data?.has_callback_secret && !window.confirm('Generate a new callback secret? The old one stops working immediately.')) return;
    setRotating(true);
    setProblem(null);
    try {
      const res = await fetch(`/api/portal/sources/${sourceId}/callback-secret`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenant_slug: tenantSlug }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; secret?: string };
      if (!res.ok || !body.secret) {
        setProblem(ERRORS[body.error ?? ''] ?? `Could not generate a secret (${body.error ?? res.status}).`);
        return;
      }
      setSecret(body.secret);
      setData((d) => d && { ...d, has_callback_secret: true });
    } finally {
      setRotating(false);
    }
  }

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.clients ?? []).filter((c) =>
      (!onlyUnmapped || c.projects.length === 0) && (!q || c.name.toLowerCase().includes(q) || c.external_id.toLowerCase().includes(q)));
  }, [data, query, onlyUnmapped]);

  const unmapped = (data?.clients ?? []).filter((c) => c.projects.length === 0 && c.active).length;
  const projectName = (id: string) => {
    const p = data?.projects.find((x) => x.id === id);
    return p ? (p.enabled ? p.name : `${p.name} (disabled)`) : 'Unknown project';
  };

  return (
    <div className="card flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[16px] font-semibold text-ink">{sourceName} · clients</div>
          <div className="mt-1 max-w-[70ch] text-[14px] text-muted" style={{ lineHeight: 1.6 }}>
            Pick the repositories each client&apos;s requests are built in. {sourceName} sends the client with
            every ticket. With more than one repository, AgentSync reads the ticket and picks the right one, using
            the note you give each; when it can&apos;t tell, a person chooses on the ticket. Tickets from an
            unmapped client are held back until you map it.
          </div>
        </div>
        <button className="btn" onClick={rotate} disabled={rotating || !tenantSlug}>
          {rotating ? 'Generating…' : data?.has_callback_secret ? 'New callback secret' : 'Generate callback secret'}
        </button>
      </div>

      {secret ? (
        <div className="flex flex-col gap-2 rounded-md border border-line bg-raised p-3">
          <div className="text-[14px] font-semibold text-gate-ink">Copy this callback secret now. It will not be shown again.</div>
          <CopyBlock text={secret} />
          <div className="text-[13px] text-muted-2">
            Give it to {sourceName} (a one-click connection does this for you). Every update AgentSync posts back
            carries <code> x-agentsync-signature: sha256=…</code>, an HMAC of the body made with this secret.
          </div>
        </div>
      ) : null}

      {problem ? <div className="text-[13.5px] text-danger-ink">{problem}</div> : null}

      {!data ? (
        <div className="text-[14px] text-muted">Loading clients…</div>
      ) : data.clients.length === 0 ? (
        <div className="text-[14px] text-muted" style={{ lineHeight: 1.6 }}>
          No clients yet. They appear here when {sourceName} sends its client list (<code>PUT /api/v1/agent/clients</code>)
          or its first ticket.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <input
              className="field-input max-w-[320px] flex-1"
              placeholder="Search clients"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <label className="flex items-center gap-2 text-[13.5px] text-ink-2">
              <input type="checkbox" checked={onlyUnmapped} onChange={(e) => setOnlyUnmapped(e.target.checked)} />
              Only unmapped ({unmapped})
            </label>
            <span className="mono text-[12px] text-muted-2">
              {data.clients.length - unmapped} of {data.clients.length} mapped
            </span>
          </div>

          <div className="overflow-x-auto rounded-md border border-line">
            <div className="grid min-w-[860px] grid-cols-[minmax(200px,1fr)_minmax(400px,520px)_70px_100px] items-start gap-3 border-b border-line bg-raised px-3.5 py-[9px]">
              <span className="label">Client</span>
              <span className="label">Repositories and what each is for</span>
              <span className="label">Tasks</span>
              <span className="label">Last seen</span>
            </div>
            {shown.map((c) => (
              <div
                key={c.external_id}
                className="grid min-w-[860px] grid-cols-[minmax(200px,1fr)_minmax(400px,520px)_70px_100px] items-start gap-3 border-b border-line-faint px-3.5 py-[9px]"
              >
                <div className="min-w-0 pt-1.5">
                  <div className={`truncate text-[14.5px] font-medium ${c.active ? '' : 'text-muted'}`}>{c.name}</div>
                  <div className="mono truncate text-[11.5px] text-muted-2">{c.active ? c.external_id : `${c.external_id} · inactive`}</div>
                </div>
                <div className="flex flex-col gap-1.5">
                  {c.projects.map((m) => (
                    <div key={m.project_id} className="flex items-center gap-2">
                      <span className="w-[150px] shrink-0 truncate text-[13.5px] font-medium" title={projectName(m.project_id)}>
                        {projectName(m.project_id)}
                      </span>
                      <input
                        className="field-input min-h-[38px] flex-1 text-[13px]"
                        placeholder={c.projects.length > 1 ? 'What is it for? e.g. public website' : 'Note (used when there are several)'}
                        defaultValue={m.hint ?? ''}
                        maxLength={300}
                        disabled={saving === c.external_id}
                        aria-label={`What ${projectName(m.project_id)} is for`}
                        onBlur={(e) => {
                          const hint = e.target.value.trim() || null;
                          if (hint === (m.hint ?? null)) return;
                          void save(c, c.projects.map((x) => (x.project_id === m.project_id ? { ...x, hint } : x)));
                        }}
                      />
                      <button
                        className="flex size-[34px] shrink-0 items-center justify-center rounded-md text-muted hover:bg-raised hover:text-danger-ink"
                        disabled={saving === c.external_id}
                        onClick={() => void save(c, c.projects.filter((x) => x.project_id !== m.project_id))}
                        aria-label={`Remove ${projectName(m.project_id)} from ${c.name}`}
                        title="Remove"
                      >
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8" /></svg>
                      </button>
                    </div>
                  ))}
                  <select
                    className="field-input min-h-[38px] text-[13px]"
                    value=""
                    disabled={saving === c.external_id}
                    onChange={(e) => {
                      if (e.target.value) void save(c, [...c.projects, { project_id: e.target.value, hint: null }]);
                    }}
                    aria-label={`Add a repository for ${c.name}`}
                  >
                    <option value="">{c.projects.length ? '+ Add another repository' : 'Not mapped · choose a repository'}</option>
                    {data.projects
                      .filter((p) => !c.projects.some((m) => m.project_id === p.id))
                      .map((p) => (
                        <option key={p.id} value={p.id}>{p.enabled ? p.name : `${p.name} (disabled)`}</option>
                      ))}
                  </select>
                </div>
                <span className="mono pt-2.5 text-[12px] text-muted">{c.task_count}</span>
                <span className="mono pt-2.5 text-[12px] text-muted-2"><Ago iso={c.last_seen_at} /></span>
              </div>
            ))}
            {shown.length === 0 ? <div className="px-3.5 py-3 text-[14px] text-muted">No clients match.</div> : null}
          </div>
        </>
      )}
    </div>
  );
}
