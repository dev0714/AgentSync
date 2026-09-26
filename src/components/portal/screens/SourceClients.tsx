'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Ago, CopyBlock } from '../ui';

/**
 * A source system's clients, each mapped to the repository its requests are
 * built in. A service desk sends the client with every ticket; AgentSync
 * routes the task to the mapped project, and refuses it (CLIENT_NOT_MAPPED)
 * until a person picks one here.
 */

type Client = {
  external_id: string;
  name: string;
  project_id: string | null;
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

  async function map(client: Client, projectId: string) {
    setSaving(client.external_id);
    setProblem(null);
    try {
      const res = await fetch(`/api/portal/sources/${sourceId}/clients`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenant_slug: tenantSlug, external_id: client.external_id, project_id: projectId || null }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setProblem(ERRORS[body.error ?? ''] ?? `Could not save (${body.error ?? res.status}).`);
        return;
      }
      setData((d) => d && {
        ...d,
        clients: d.clients.map((c) => (c.external_id === client.external_id ? { ...c, project_id: projectId || null } : c)),
      });
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
      (!onlyUnmapped || !c.project_id) && (!q || c.name.toLowerCase().includes(q) || c.external_id.toLowerCase().includes(q)));
  }, [data, query, onlyUnmapped]);

  const unmapped = (data?.clients ?? []).filter((c) => !c.project_id && c.active).length;

  return (
    <div className="card flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[16px] font-semibold text-ink">{sourceName} · clients</div>
          <div className="mt-1 max-w-[70ch] text-[14px] text-muted" style={{ lineHeight: 1.6 }}>
            Pick the repository each client&apos;s requests are built in. {sourceName} sends the client with
            every ticket; tickets from an unmapped client are held back until you map it.
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
            Set it as <code>AGENTSYNC_CALLBACK_SECRET</code> on {sourceName}. Every update AgentSync posts back carries
            <code> x-agentsync-signature: sha256=…</code>, an HMAC of the body made with this secret.
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
            <div className="grid min-w-[720px] grid-cols-[minmax(220px,1fr)_minmax(240px,320px)_90px_110px] items-center gap-3 border-b border-line bg-raised px-3.5 py-[9px]">
              <span className="label">CLIENT</span>
              <span className="label">REPOSITORY</span>
              <span className="label">TASKS</span>
              <span className="label">LAST SEEN</span>
            </div>
            {shown.map((c) => (
              <div
                key={c.external_id}
                className="grid min-w-[720px] grid-cols-[minmax(220px,1fr)_minmax(240px,320px)_90px_110px] items-center gap-3 border-b border-line-faint px-3.5 py-[9px]"
              >
                <div className="min-w-0">
                  <div className={`truncate text-[14.5px] font-medium ${c.active ? '' : 'text-muted'}`}>{c.name}</div>
                  <div className="mono truncate text-[11.5px] text-muted-2">{c.active ? c.external_id : `${c.external_id} · inactive`}</div>
                </div>
                <select
                  className="field-input"
                  value={c.project_id ?? ''}
                  disabled={saving === c.external_id}
                  onChange={(e) => void map(c, e.target.value)}
                  aria-label={`Repository for ${c.name}`}
                >
                  <option value="">Not mapped</option>
                  {data.projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.enabled ? p.name : `${p.name} (disabled)`}</option>
                  ))}
                </select>
                <span className="mono text-[12px] text-muted">{c.task_count}</span>
                <span className="mono text-[12px] text-muted-2"><Ago iso={c.last_seen_at} /></span>
              </div>
            ))}
            {shown.length === 0 ? <div className="px-3.5 py-3 text-[14px] text-muted">No clients match.</div> : null}
          </div>
        </>
      )}
    </div>
  );
}
