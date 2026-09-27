'use client';

import { useState } from 'react';

/**
 * Linking every project to its Supabase project in one go. AgentSync reads
 * each repository for the project it names (supabase/config.toml, env example
 * files, the Supabase client); the person reviews, adjusts and links. Nothing
 * is saved until "Link selected".
 */

type Row = {
  project_id: string;
  name: string;
  repository: string | null;
  linked: string | null;
  suggested: string | null;
  source: string | null;
  unseen: string | null;
  error: string | null;
};

export default function SupabaseLinks({
  tenantSlug,
  projects,
}: {
  tenantSlug: string | null;
  projects: { ref: string; name: string }[];
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<'find' | 'link' | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const nameOf = (ref: string | null) => projects.find((p) => p.ref === ref)?.name ?? ref ?? '';

  async function find() {
    setBusy('find');
    setNote(null);
    try {
      const res = await fetch('/api/portal/connections/supabase/suggest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenant_slug: tenantSlug }),
      });
      const data = (await res.json().catch(() => ({}))) as { projects?: Row[]; error?: string };
      if (!res.ok || !data.projects) {
        setNote({ ok: false, text: `Could not look (${data.error ?? res.status}).` });
        return;
      }
      setRows(data.projects);
      // Preselect suggestions that would change something; leave linked ones alone.
      setChoice(Object.fromEntries(data.projects.map((r) => [r.project_id, r.linked ?? r.suggested ?? ''])));
      setTicked(Object.fromEntries(data.projects.map((r) => [r.project_id, !!r.suggested && r.suggested !== r.linked])));
    } finally {
      setBusy(null);
    }
  }

  async function link() {
    if (!rows) return;
    const todo = rows.filter((r) => ticked[r.project_id]);
    setBusy('link');
    setNote(null);
    let done = 0;
    const failed: string[] = [];
    for (const r of todo) {
      const res = await fetch(`/api/portal/projects/${r.project_id}/database`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ supabase_project_ref: choice[r.project_id] || null }),
      });
      if (res.ok) done++;
      else failed.push(r.name);
    }
    setRows(rows.map((r) => (ticked[r.project_id] && !failed.includes(r.name) ? { ...r, linked: choice[r.project_id] || null } : r)));
    setTicked({});
    setBusy(null);
    setNote(failed.length
      ? { ok: false, text: `Linked ${done}; could not save ${failed.join(', ')}.` }
      : { ok: true, text: `Linked ${done} project${done === 1 ? '' : 's'}.` });
  }

  const found = rows?.filter((r) => r.suggested).length ?? 0;
  const count = Object.values(ticked).filter(Boolean).length;

  return (
    <div className="flex flex-col gap-3 border-t border-line-soft pt-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[14.5px] font-semibold text-ink">Link projects to their databases</span>
          <span className="text-[13px] text-muted-3">
            AgentSync reads each repository for the Supabase project it uses. Check the matches, then link.
          </span>
        </div>
        <button className="btn" disabled={!!busy} onClick={() => void find()}>
          {busy === 'find' ? 'Reading repositories…' : rows ? 'Look again' : 'Find links'}
        </button>
      </div>

      {rows ? (
        <>
          <div className="text-[13px] text-muted-3">
            Found a Supabase project in {found} of {rows.length} repositories.
          </div>
          <div className="overflow-x-auto rounded-[10px] border border-line-soft">
            <table className="w-full min-w-[640px] border-collapse text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-line-soft">
                  <th className="w-10 px-3 py-2" />
                  <th className="label px-3 py-2">Project</th>
                  <th className="label px-3 py-2">Supabase project</th>
                  <th className="label px-3 py-2">Found in</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.project_id} className="border-b border-line-faint last:border-b-0">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Link ${r.name}`}
                        className="size-4 accent-[var(--color-ink)]"
                        checked={!!ticked[r.project_id]}
                        onChange={(e) => setTicked({ ...ticked, [r.project_id]: e.target.checked })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{r.name}</div>
                      {r.linked ? <div className="text-[12px] text-ok-ink">Linked: {nameOf(r.linked)}</div> : null}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        className="field-select h-8 min-w-[220px] text-[13px]"
                        value={choice[r.project_id] ?? ''}
                        onChange={(e) => {
                          setChoice({ ...choice, [r.project_id]: e.target.value });
                          setTicked({ ...ticked, [r.project_id]: true });
                        }}
                      >
                        <option value="">Not linked</option>
                        {projects.map((p) => (
                          <option key={p.ref} value={p.ref}>
                            {p.name} · {p.ref}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-[12.5px] text-muted-3">
                      {r.source ? (
                        <span className="mono">{r.source}</span>
                      ) : r.unseen ? (
                        <span>Names {r.unseen}, which this token can’t see</span>
                      ) : r.error ? (
                        <span>{r.error}</span>
                      ) : (
                        <span>No Supabase found</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-3">
            <button className="btn-primary" disabled={!!busy || count === 0} onClick={() => void link()}>
              {busy === 'link' ? 'Linking…' : `Link selected (${count})`}
            </button>
          </div>
        </>
      ) : null}
      {note ? <div className={`text-[13.5px] ${note.ok ? 'text-ok-ink' : 'text-danger-ink'}`}>{note.text}</div> : null}
    </div>
  );
}
