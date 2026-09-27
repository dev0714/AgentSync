'use client';

import { useEffect, useState } from 'react';

/**
 * A project's database: which Supabase project its database changes run on,
 * and where its migration files live. Pick a project from the tenant's
 * Supabase connection; without a connection, scripts are marked as applied by
 * hand at the merge approval.
 */

type Data = {
  ok: boolean;
  can_edit: boolean;
  supabase_project_ref: string | null;
  migration_paths: string[] | null;
  connection: { organization: string | null; projects: { ref: string; name: string; region: string | null }[] } | null;
};

export default function ProjectDatabase({ projectId }: { projectId: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [ref, setRef] = useState('');
  const [paths, setPaths] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let live = true;
    setData(null);
    fetch(`/api/portal/projects/${projectId}/database`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: Data) => {
        if (!live) return;
        setData(d);
        setRef(d.supabase_project_ref ?? '');
        setPaths((d.migration_paths ?? []).join('\n'));
      })
      .catch(() => live && setData(null));
    return () => {
      live = false;
    };
  }, [projectId]);

  async function save() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/api/portal/projects/${projectId}/database`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          supabase_project_ref: ref || null,
          migration_paths: paths.split('\n').map((p) => p.trim()).filter(Boolean),
        }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      setNote(res.ok ? { ok: true, text: 'Saved.' } : { ok: false, text: d.error === 'NOT_AUTHORISED' ? 'A tenant admin can change this.' : `Could not save (${d.error ?? res.status}).` });
    } finally {
      setBusy(false);
    }
  }

  const projects = data?.connection?.projects ?? [];
  const current = projects.find((p) => p.ref === ref);

  return (
    <div className="flex flex-col gap-4 rounded-[10px] border border-line-soft p-5">
      <div>
        <div className="text-[15px] font-semibold text-ink">Database</div>
        <div className="text-[13.5px] text-muted-3">
          When a change carries SQL under the migration paths, the merge waits until it has run on this database — from the
          merge approval, or by hand and marked as applied.
        </div>
      </div>
      {!data ? (
        <div className="text-[13.5px] text-muted">Loading…</div>
      ) : (
        <>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13.5px] font-medium text-ink-2">Supabase project</span>
            {data.connection ? (
              <select className="field-select" value={ref} disabled={!data.can_edit} onChange={(e) => setRef(e.target.value)}>
                <option value="">Not linked — apply scripts by hand</option>
                {projects.map((p) => (
                  <option key={p.ref} value={p.ref}>
                    {p.name} · {p.ref}
                    {p.region ? ` · ${p.region}` : ''}
                  </option>
                ))}
                {ref && !current ? <option value={ref}>{ref} (not visible to the current token)</option> : null}
              </select>
            ) : (
              <span className="text-[13.5px] text-muted-3">
                Connect Supabase under Connections → Supabase to pick a project here.
                {ref ? <span className="mono"> Linked now: {ref}.</span> : null}
              </span>
            )}
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13.5px] font-medium text-ink-2">Migration paths</span>
            <textarea
              className="field-input mono min-h-[96px] py-2 text-[12.5px]"
              value={paths}
              disabled={!data.can_edit}
              onChange={(e) => setPaths(e.target.value)}
            />
            <span className="text-[12.5px] text-muted-3">One pattern per line. Only .sql files under these paths count as database changes.</span>
          </label>
          {data.can_edit ? (
            <div className="flex items-center gap-3">
              <button className="btn-primary" disabled={busy} onClick={() => void save()}>
                {busy ? 'Saving…' : 'Save'}
              </button>
              {note ? <span className={`text-[13.5px] ${note.ok ? 'text-ok-ink' : 'text-danger-ink'}`}>{note.text}</span> : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
