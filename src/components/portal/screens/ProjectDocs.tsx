'use client';

import { diffLines } from 'diff';
import { useCallback, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Ago, Pill, Tabs } from '../ui';

/**
 * A project's AGENTSYNC.md — what the project is and does — with every version
 * of it (who or which task changed it, when, and what changed) and the
 * project's releases. Edits and restores reach the repository by pull request.
 */

type Version = {
  version: number;
  source: 'repository' | 'import' | 'agent' | 'person' | 'restore';
  author_name: string | null;
  task_id: string | null;
  task_title: string | null;
  note: string | null;
  created_at: string;
  length: number;
};
type Release = {
  version: string;
  bump: string;
  status: 'reserved' | 'released';
  title: string | null;
  notes: string | null;
  tag: string | null;
  commit_sha: string | null;
  pr_url: string | null;
  task_id: string | null;
  created_at: string;
  released_at: string | null;
};
type Loaded = {
  document: { repo_state: string; pr_url: string | null; current_version: number; path: string; checked_at: string | null } | null;
  current: { version: number; content: string; source: Version['source']; author_name: string | null; created_at: string; note: string | null; task_id: string | null } | null;
  versions: Version[];
  release_version: string | null;
  releases: Release[];
};

const SOURCE_LABEL: Record<Version['source'], string> = {
  repository: 'From the repository',
  import: 'Imported',
  agent: 'Edited by AgentSync',
  person: 'Edited',
  restore: 'Restored',
};
const SOURCE_COLOUR: Record<Version['source'], string> = {
  repository: '#5f616a',
  import: '#5f616a',
  agent: '#0550c4',
  person: '#1f7a4d',
  restore: '#963510',
};
const REPO_STATE: Record<string, { label: string; colour: string }> = {
  in_sync: { label: 'In the repository', colour: '#1f7a4d' },
  pr_open: { label: 'Waiting in a pull request', colour: '#963510' },
  missing: { label: 'Not in the repository', colour: '#b42318' },
  unknown: { label: 'Not checked yet', colour: '#5f616a' },
};

type Tab = 'description' | 'history' | 'releases' | 'map';

export default function ProjectDocs({ projectId, tenantSlug, onOpenTask }: {
  projectId: string;
  tenantSlug: string | null;
  onOpenTask?: (taskId: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('description');
  const [data, setData] = useState<Loaded | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  const [viewing, setViewing] = useState<{ version: number; content: string; previous: string | null } | null>(null);
  const [bulk, setBulk] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/portal/projects/${projectId}/docs?tenant=${encodeURIComponent(tenantSlug ?? '')}`, { cache: 'no-store' });
    const body = (await res.json().catch(() => ({}))) as Loaded & { error?: string };
    if (!res.ok) {
      setProblem(body.error === 'NOT_AUTHORISED' ? 'Only a tenant admin can see this.' : `Could not load the description (${body.error ?? res.status}).`);
      return;
    }
    setData(body);
  }, [projectId, tenantSlug]);

  useEffect(() => {
    setData(null);
    setEditing(false);
    setViewing(null);
    setNotice(null);
    void load();
  }, [load]);

  async function act(action: string, extra: Record<string, unknown> = {}, label = action) {
    setBusy(label);
    setProblem(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/portal/projects/${projectId}/docs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenant_slug: tenantSlug, action, ...extra }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; detail?: string; result?: string; pr_url?: string | null; state?: string; version?: number };
      if (!res.ok) {
        setProblem(body.detail ?? `Could not ${action} (${body.error ?? res.status}).`);
        return null;
      }
      await load();
      return body;
    } finally {
      setBusy(null);
    }
  }

  async function view(version: number) {
    const get = (v: number) =>
      fetch(`/api/portal/projects/${projectId}/docs/versions/${v}?tenant=${encodeURIComponent(tenantSlug ?? '')}`)
        .then((r) => (r.ok ? (r.json() as Promise<{ content: string }>) : null));
    const [now, before] = await Promise.all([get(version), version > 1 ? get(version - 1) : Promise.resolve(null)]);
    if (now) setViewing({ version, content: now.content, previous: before?.content ?? null });
  }

  async function importAll() {
    setProblem(null);
    let total = 0;
    let failed = 0;
    for (let round = 0; round < 10; round++) {
      setBulk(`Working through your projects… ${total} done`);
      const res = await fetch('/api/portal/projects/docs/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenant_slug: tenantSlug }),
      });
      const body = (await res.json().catch(() => ({}))) as { done?: { result: string }[]; remaining?: number; error?: string };
      if (!res.ok) {
        setProblem(`Could not import (${body.error ?? res.status}).`);
        break;
      }
      total += body.done?.length ?? 0;
      failed += body.done?.filter((d) => d.result === 'failed').length ?? 0;
      if (!body.remaining || !body.done?.length) break;
    }
    setBulk(null);
    setNotice(`${total} project${total === 1 ? '' : 's'} done${failed ? `, ${failed} could not be read (check the GitHub App can reach them)` : ''}. Projects without an AGENTSYNC.md now have a pull request adding one.`);
    await load();
  }

  const doc = data?.document;
  const current = data?.current;
  const state = REPO_STATE[doc?.repo_state ?? 'unknown'] ?? REPO_STATE.unknown;

  return (
    <div className="card overflow-hidden">
      <div className="card-head">
        <Tabs<Tab>
          tabs={[
            { k: 'description', label: 'Description' },
            { k: 'history', label: `History${data?.versions.length ? ` · ${data.versions.length}` : ''}` },
            { k: 'releases', label: `Releases${data?.release_version ? ` · v${data.release_version}` : ''}` },
            { k: 'map', label: 'Map' },
          ]}
          active={tab}
          onSelect={(k) => { setTab(k); setViewing(null); }}
        />
      </div>

      <div className="flex flex-col gap-4 p-4">
        {problem ? <div className="text-[13.5px] text-danger-ink">{problem}</div> : null}
        {notice ? <div className="rounded-md border border-line bg-raised px-3 py-2 text-[13.5px] text-ink-2">{notice}</div> : null}

        {tab === 'map' ? (
          <ProjectMap projectId={projectId} tenantSlug={tenantSlug} />
        ) : !data ? (
          <div className="text-[14px] text-muted">Loading…</div>
        ) : tab === 'description' ? (
          !current ? (
            <div className="flex flex-col gap-3">
              <div className="text-[14.5px] font-semibold">No AGENTSYNC.md yet</div>
              <p className="m-0 max-w-[70ch] text-[14px] text-muted" style={{ lineHeight: 1.6 }}>
                AGENTSYNC.md says what this project is and does. AgentSync&apos;s agents read it before planning a change,
                and it&apos;s versioned here. AgentSync reads it from the repository, or copies the README into a new one and
                opens a pull request to add it.
              </p>
              <div className="flex flex-wrap gap-2">
                <button className="btn-primary" disabled={Boolean(busy || bulk)} onClick={() => void act('import', {}, 'import').then((r) => r && setNotice(
                  r.result === 'created' ? 'A pull request adding AGENTSYNC.md is open; merge it to put it in the repository.'
                    : r.result === 'imported' ? 'Read AGENTSYNC.md from the repository.'
                      : r.result === 'no_repository' ? 'This project has no GitHub repository connected.' : 'Done.'))}>
                  {busy === 'import' ? 'Working…' : 'Create for this project'}
                </button>
                <button className="btn" disabled={Boolean(busy || bulk)} onClick={() => void importAll()}>
                  {bulk ?? 'Create for every project'}
                </button>
              </div>
            </div>
          ) : editing ? (
            <div className="flex flex-col gap-3">
              <textarea
                className="field-input mono min-h-[420px] w-full p-3 text-[13px] leading-[1.55]"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                aria-label="AGENTSYNC.md"
                spellCheck
              />
              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium text-ink-2">What changed (optional)</span>
                <input className="field-input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Added the booking API" />
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  className="btn-primary"
                  disabled={Boolean(busy) || !draft.trim() || draft === current.content}
                  onClick={() => void act('save', { content: draft, note }, 'save').then((r) => {
                    if (!r) return;
                    setEditing(false);
                    setNotice(r.pr_url ? `Saved as version ${r.version}. A pull request updates the repository: ${r.pr_url}` : `Saved as version ${r.version}.`);
                  })}
                >
                  {busy === 'save' ? 'Saving…' : 'Save and open pull request'}
                </button>
                <button className="btn" disabled={Boolean(busy)} onClick={() => setEditing(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="mono text-[12.5px] font-semibold">{doc?.path ?? 'AGENTSYNC.md'} · v{current.version}</span>
                <span className="text-[13px] text-ink-2">
                  <span style={{ color: SOURCE_COLOUR[current.source] }} className="font-semibold">{SOURCE_LABEL[current.source]}</span>
                  {current.author_name && current.source !== 'agent' ? ` by ${current.author_name}` : ''}
                  {' · '}<Ago iso={current.created_at} />
                  {current.task_id && onOpenTask ? (
                    <> · <button className="underline decoration-line underline-offset-4 hover:decoration-ink" onClick={() => onOpenTask(current.task_id!)}>see the task</button></>
                  ) : null}
                </span>
                <Pill c={['#f3f0e8', state.colour]}>{state.label}</Pill>
                {doc?.repo_state === 'pr_open' && doc.pr_url ? (
                  <a href={doc.pr_url} target="_blank" rel="noreferrer" className="text-[13px] underline underline-offset-4">Open the pull request ↗</a>
                ) : null}
                <div className="ml-auto flex gap-2">
                  <button className="btn min-h-[38px] px-3 text-[13.5px]" disabled={Boolean(busy)} onClick={() => void act('refresh', {}, 'refresh').then((r) => r && setNotice(
                    r.state === 'pr_open' ? 'The pull request is still open.' : r.state === 'in_sync' ? 'Up to date with the repository.' : 'AGENTSYNC.md is not in the repository.'))}>
                    {busy === 'refresh' ? 'Checking…' : 'Check repository'}
                  </button>
                  <button className="btn min-h-[38px] px-3 text-[13.5px]" disabled={Boolean(busy)} onClick={() => { setDraft(current.content); setNote(''); setEditing(true); }}>
                    Edit
                  </button>
                </div>
              </div>
              <article className="md-doc rounded-md border border-line bg-card px-5 py-4">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{current.content.replace(/^<!--[\s\S]*?-->\s*/, '')}</ReactMarkdown>
              </article>
            </div>
          )
        ) : tab === 'history' ? (
          viewing ? (
            <VersionView
              viewing={viewing}
              meta={data.versions.find((v) => v.version === viewing.version) ?? null}
              isCurrent={viewing.version === current?.version}
              busy={busy === 'restore'}
              onBack={() => setViewing(null)}
              onRestore={() => void act('restore', { version: viewing.version }, 'restore').then((r) => {
                if (!r) return;
                setViewing(null);
                setTab('description');
                setNotice(`Version ${viewing.version} restored as version ${r.version}.${r.pr_url ? ` Pull request: ${r.pr_url}` : ''}`);
              })}
            />
          ) : data.versions.length === 0 ? (
            <div className="text-[14px] text-muted">No versions yet.</div>
          ) : (
            <ol className="m-0 flex list-none flex-col p-0">
              {data.versions.map((v) => (
                <li key={v.version} className="border-b border-line-faint last:border-0">
                  <button className="row-hover flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-2 py-2.5 text-left" onClick={() => void view(v.version)}>
                    <span className="mono w-[44px] text-[12.5px] font-semibold">v{v.version}</span>
                    <span className="text-[13.5px] font-medium" style={{ color: SOURCE_COLOUR[v.source] }}>{SOURCE_LABEL[v.source]}</span>
                    <span className="text-[13px] text-ink-2">{v.task_title ?? v.note ?? (v.author_name ? `by ${v.author_name}` : '')}</span>
                    <span className="mono ml-auto text-[12px] text-muted-2"><Ago iso={v.created_at} /></span>
                  </button>
                </li>
              ))}
            </ol>
          )
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-baseline gap-3">
              <span className="text-[13px] text-muted">Current version</span>
              <span className="display text-[26px] font-bold tracking-[-0.02em]">{data.release_version ? `v${data.release_version}` : 'none yet'}</span>
            </div>
            <p className="m-0 max-w-[75ch] text-[13.5px] text-muted" style={{ lineHeight: 1.6 }}>
              Every pull request AgentSync prepares takes the next version (major, minor or patch, chosen by the Reviewer) and adds a
              CHANGELOG.md entry. Merging it releases that version and tags the merge commit.
            </p>
            {data.releases.length === 0 ? (
              <div className="text-[14px] text-muted">No releases yet.</div>
            ) : (
              <ol className="m-0 flex list-none flex-col gap-2 p-0">
                {data.releases.map((r) => (
                  <li key={r.version} className="rounded-md border border-line px-3.5 py-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="mono text-[14px] font-semibold">v{r.version}</span>
                      <Pill c={r.status === 'released' ? ['#ddefe3', '#17603c'] : ['#fbe7da', '#963510']}>
                        {r.status === 'released' ? 'Released' : 'Waiting for merge'}
                      </Pill>
                      <span className="text-[12.5px] text-muted">{r.bump}</span>
                      <span className="text-[13.5px] text-ink-2">{r.title}</span>
                      <span className="mono ml-auto text-[12px] text-muted-2"><Ago iso={r.released_at ?? r.created_at} /></span>
                    </div>
                    {r.notes ? (
                      <div className="md-doc mt-2 text-[13.5px]"><ReactMarkdown remarkPlugins={[remarkGfm]}>{r.notes}</ReactMarkdown></div>
                    ) : null}
                    <div className="mt-1.5 flex flex-wrap gap-3 text-[12.5px]">
                      {r.tag ? <span className="mono text-muted">tag {r.tag}{r.commit_sha ? ` · ${r.commit_sha.slice(0, 7)}` : ''}</span> : null}
                      {r.pr_url ? <a href={r.pr_url} target="_blank" rel="noreferrer" className="underline underline-offset-4">Pull request ↗</a> : null}
                      {r.task_id && onOpenTask ? <button className="underline underline-offset-4" onClick={() => onOpenTask(r.task_id!)}>Task</button> : null}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function VersionView({ viewing, meta, isCurrent, busy, onBack, onRestore }: {
  viewing: { version: number; content: string; previous: string | null };
  meta: Version | null;
  isCurrent: boolean;
  busy: boolean;
  onBack: () => void;
  onRestore: () => void;
}) {
  const [mode, setMode] = useState<'changes' | 'text'>(viewing.previous !== null ? 'changes' : 'text');
  const parts = viewing.previous !== null ? diffLines(viewing.previous, viewing.content) : [];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn min-h-[36px] px-3 text-[13px]" onClick={onBack}>← All versions</button>
        <span className="mono text-[13px] font-semibold">v{viewing.version}</span>
        {meta ? (
          <span className="text-[13px] text-ink-2">
            <span style={{ color: SOURCE_COLOUR[meta.source] }} className="font-semibold">{SOURCE_LABEL[meta.source]}</span>
            {meta.author_name && meta.source !== 'agent' ? ` by ${meta.author_name}` : ''} · <Ago iso={meta.created_at} />
            {meta.task_title ? ` · ${meta.task_title}` : meta.note ? ` · ${meta.note}` : ''}
          </span>
        ) : null}
        <div className="ml-auto flex gap-2">
          {viewing.previous !== null ? (
            <button className="btn min-h-[36px] px-3 text-[13px]" onClick={() => setMode(mode === 'changes' ? 'text' : 'changes')}>
              {mode === 'changes' ? 'Show the text' : `Show changes from v${viewing.version - 1}`}
            </button>
          ) : null}
          {!isCurrent ? (
            <button className="btn-primary min-h-[36px] px-3 text-[13px]" disabled={busy} onClick={onRestore}>
              {busy ? 'Restoring…' : 'Restore this version'}
            </button>
          ) : null}
        </div>
      </div>
      {mode === 'changes' ? (
        <pre className="mono m-0 max-h-[560px] overflow-auto rounded-md border border-line bg-card p-3 text-[12.5px] leading-[1.55] whitespace-pre-wrap">
          {parts.map((p, i) => (
            <span
              key={i}
              style={p.added ? { background: '#ddefe3', color: '#17603c' } : p.removed ? { background: '#fbe3e1', color: '#b42318', textDecoration: 'line-through' } : { color: '#4f515a' }}
            >
              {p.value}
            </span>
          ))}
        </pre>
      ) : (
        <article className="md-doc rounded-md border border-line bg-card px-5 py-4">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{viewing.content.replace(/^<!--[\s\S]*?-->\s*/, '')}</ReactMarkdown>
        </article>
      )}
    </div>
  );
}

/* ---- the code map (Graphify) ---------------------------------------------- */

type MapRow = {
  status: 'queued' | 'running' | 'ready' | 'failed';
  reason: string | null;
  commit_sha: string | null;
  mapped_at: string | null;
  started_at: string | null;
  graphify_version: string | null;
  stats: { nodes?: number; edges?: number; communities?: number; files?: number } | null;
  files: Record<string, number> | null;
  error: string | null;
};

function ProjectMap({ projectId, tenantSlug }: { projectId: string; tenantSlug: string | null }) {
  const [map, setMap] = useState<MapRow | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [available, setAvailable] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [view, setView] = useState<'report' | 'graph'>('report');
  const q = `tenant=${encodeURIComponent(tenantSlug ?? '')}`;

  const load = useCallback(async () => {
    const res = await fetch(`/api/portal/projects/${projectId}/map?${q}`, { cache: 'no-store' });
    const body = (await res.json().catch(() => ({}))) as { map?: MapRow | null; report?: string | null; available?: boolean };
    setMap(body.map ?? null);
    setReport(body.report ?? null);
    setAvailable(body.available !== false);
    setLoaded(true);
  }, [projectId, q]);

  useEffect(() => {
    void load();
  }, [load]);

  // While a run is going, check back every 20 seconds.
  useEffect(() => {
    if (map?.status !== 'queued' && map?.status !== 'running') return;
    const t = setInterval(() => void load(), 20_000);
    return () => clearInterval(t);
  }, [map?.status, load]);

  async function run(all: boolean) {
    setBusy(all ? 'all' : 'one');
    setNotice(null);
    const res = await fetch(all ? '/api/portal/projects/maps/run-all' : `/api/portal/projects/${projectId}/map`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant_slug: tenantSlug }),
    });
    const body = (await res.json().catch(() => ({}))) as { queued?: number; error?: string };
    setBusy(null);
    if (!res.ok) {
      setNotice(body.error === 'NOT_AUTHORISED' ? 'Only a tenant admin can do this.' : `Could not start (${body.error ?? res.status}).`);
      return;
    }
    setNotice(all ? `${body.queued} projects queued. Two are mapped at a time, a few minutes each.` : 'Mapping has started. This takes a few minutes.');
    await load();
  }

  if (!loaded) return <div className="text-[14px] text-muted">Loading…</div>;

  const going = map?.status === 'queued' || map?.status === 'running';
  const hasMap = Boolean(map?.files?.['GRAPH_REPORT.md'] || map?.files?.['graph.json']);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {hasMap ? (
          <span className="text-[13px] text-ink-2">
            Mapped <Ago iso={map!.mapped_at} />
            {map!.commit_sha ? <> from <span className="mono">{map!.commit_sha.slice(0, 7)}</span></> : null}
            {map!.stats?.nodes ? ` · ${map!.stats.nodes.toLocaleString()} items, ${(map!.stats.edges ?? 0).toLocaleString()} connections${map!.stats.communities ? `, ${map!.stats.communities} subsystems` : ''}` : ''}
          </span>
        ) : (
          <span className="text-[13px] text-ink-2">No map yet.</span>
        )}
        {going ? <Pill c={['#fbe7da', '#963510']}>{map!.status === 'queued' ? 'Waiting to map' : 'Mapping…'}</Pill> : null}
        {map?.status === 'failed' ? <Pill c={['#fbe3e1', '#b42318']}>Last run failed</Pill> : null}
        <div className="ml-auto flex gap-2">
          {hasMap ? (
            <button className="btn min-h-[38px] px-3 text-[13.5px]" onClick={() => setView(view === 'report' ? 'graph' : 'report')}>
              {view === 'report' ? 'Interactive map' : 'Report'}
            </button>
          ) : null}
          <button className="btn min-h-[38px] px-3 text-[13.5px]" disabled={Boolean(busy) || going || !available} onClick={() => void run(false)}>
            {busy === 'one' ? 'Starting…' : hasMap ? 'Map again' : 'Map this project'}
          </button>
          <button className="btn min-h-[38px] px-3 text-[13.5px]" disabled={Boolean(busy) || !available} onClick={() => void run(true)}>
            {busy === 'all' ? 'Queuing…' : 'Map every project'}
          </button>
        </div>
      </div>

      {!available ? (
        <div className="rounded-md border border-line bg-raised px-3 py-2 text-[13.5px] text-ink-2">
          Maps run in a Vercel Sandbox, which is only reachable from the deployed AgentSync (or with VERCEL_ACCESS_TOKEN, VERCEL_TEAM_ID and VERCEL_PROJECT_ID set).
        </div>
      ) : null}
      {notice ? <div className="rounded-md border border-line bg-raised px-3 py-2 text-[13.5px] text-ink-2">{notice}</div> : null}
      {map?.status === 'failed' && map.error ? (
        <pre className="mono m-0 max-h-[180px] overflow-auto rounded-md border border-[#e7b8b2] bg-danger-tint p-3 text-[12px] whitespace-pre-wrap text-danger-ink">{map.error}</pre>
      ) : null}

      {!hasMap ? (
        <p className="m-0 max-w-[75ch] text-[14px] text-muted" style={{ lineHeight: 1.6 }}>
          A map shows how this project&apos;s code fits together: its main pieces, the subsystems they form and how they connect.
          AgentSync makes it with Graphify, which parses the code in a private sandbox, with no AI model and no cost per run.
          It is remade after every change AgentSync merges, and the agents read it before planning.
        </p>
      ) : view === 'graph' && map?.files?.['graph.html'] ? (
        <iframe
          title="Interactive code map"
          src={`/api/portal/projects/${projectId}/map/graph?${q}`}
          sandbox="allow-scripts allow-popups"
          className="h-[640px] w-full rounded-md border border-line bg-card"
        />
      ) : view === 'graph' ? (
        <div className="text-[14px] text-muted">This map has no interactive view (it was too large to keep).</div>
      ) : report ? (
        <article className="md-doc rounded-md border border-line bg-card px-5 py-4">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{report}</ReactMarkdown>
        </article>
      ) : (
        <div className="text-[14px] text-muted">The map has no report.</div>
      )}
    </div>
  );
}
