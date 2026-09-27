'use client';

import type {
  Project as ProjectRecord,
  SourceRow,
} from '@/lib/portal-data';
import {
  STATE_COLOUR,
  rowsFrom,
  swatch,
  type Row,
} from '@/lib/portal-ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Ago, FieldRows, Pill, Tabs } from '../ui';
import RequestForm from './RequestForm';
import { TierPicker, useTierSettings, type EngineerMode, type Tier } from '../tiers';
import { IssueKeyForm } from './SetupForms';
import SourceClients from './SourceClients';
import ProjectDocs, { type DocsTab } from './ProjectDocs';
import ProjectDatabase from './ProjectDatabase';

type ProjectTab = DocsTab | 'settings' | 'request';

function SetupCard({ title, detail, children }: { title: string; detail: string; children: React.ReactNode }) {
  return (
    <div className="card flex flex-col gap-4 p-6">
      <div>
        <div className="text-[16px] font-semibold text-ink">{title}</div>
        <div className="mt-1 max-w-[70ch] text-[14px] text-muted" style={{ lineHeight: 1.6 }}>{detail}</div>
      </div>
      {children}
    </div>
  );
}

/* ---- projects -------------------------------------------------------- */

type Group = { title: string; table: string; rows: Row[]; missing?: string };

function groupsFor(project: ProjectRecord): Group[] {
  return [
    {
      title: 'Approvals & policy',
      table: 'projects',
      rows: rowsFrom({
        enabled: project.enabled,
        plan_approval_required: project.plan_approval_required,
        merge_approval_required: project.merge_approval_required,
        production_requires_approval: project.production_requires_approval,
        agent_may_merge_own_pr: project.agent_may_merge_own_pr,
        direct_push_to_default: project.direct_push_to_default,
        rollback_policy: project.rollback_policy,
        monthly_ai_budget: project.monthly_ai_budget,
        callback_url: project.callback_url,
        callback_signing_secret_ref: project.callback_signing_secret_ref,
      }),
    },
    {
      title: 'Repository',
      table: 'project_repositories',
      rows: rowsFrom(project.repository as Record<string, unknown> | null),
      missing:
        'No repository is configured for this project, so no task can be checked out.',
    },
    {
      title: 'Runtime & checks',
      table: 'project_runtime_configs',
      rows: rowsFrom(project.runtime as Record<string, unknown> | null),
      missing:
        'No runtime configuration, so the Validator has no commands to run.',
    },
    {
      title: 'AI routing',
      table: 'project_ai_configs',
      rows: rowsFrom(project.ai as Record<string, unknown> | null),
      missing: 'No AI configuration, so this project falls back to tenant defaults.',
    },
  ];
}

export function Project_({
  projects,
  selected,
  onSelect,
  group,
  onGroup,
  tenantSlug,
  github,
  onConnect,
  canSubmit,
  onSubmitted,
  onOpenTask,
}: {
  /** Opens a task's detail (from the description's history or releases). */
  onOpenTask?: (taskId: string) => void;
  /** Whether the signed-in person's role may submit requests. */
  canSubmit: boolean;
  /** Called with the new task's id after a request is submitted. */
  onSubmitted: (taskId: string) => void;
  tenantSlug: string | null;
  /** The tenant's GitHub connection, or null. */
  github: Record<string, unknown> | null;
  /** Opens Connections → GitHub. */
  onConnect: () => void;
  projects: ProjectRecord[];
  selected: string | null;
  onSelect: (id: string) => void;
  group: number;
  onGroup: (i: number) => void;
}) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [tab, setTab] = useState<ProjectTab>('description');
  const [filterText, setFilterText] = useState('');
  const [summary, setSummary] = useState<{ versions: number; release: string | null } | null>(null);
  const [summaryFor, setSummaryFor] = useState<string | null>(null);
  const appSlug = typeof github?.app_slug === 'string' ? github.app_slug : null;
  const { settings: tiers, reload: reloadTiers } = useTierSettings(tenantSlug);

  async function setFailover(projectId: string, failover: boolean) {
    const res = await fetch('/api/portal/tiers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project_id: projectId, failover }),
    });
    if (res.ok) void reloadTiers();
  }

  async function setEngineerMode(projectId: string, mode: EngineerMode) {
    const res = await fetch('/api/portal/tiers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project_id: projectId, engineer_mode: mode }),
    });
    if (res.ok) void reloadTiers();
  }

  async function setProjectTier(projectId: string, tier: Tier) {
    const res = await fetch('/api/portal/tiers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project_id: projectId, tier }),
    });
    if (res.ok) void reloadTiers();
  }

  async function sync() {
    setSyncing(true);
    setSyncNote(null);
    try {
      const res = await fetch('/api/portal/projects/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenant_slug: tenantSlug }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        detail?: string;
        projects?: { created: number; enabled: number; disabled: number };
      };
      if (!res.ok || !data.projects) {
        setSyncNote({ ok: false, text: data.detail ?? `Could not sync (${data.error ?? res.status}).` });
        return;
      }
      const { created, enabled, disabled } = data.projects;
      const parts = [
        created ? `${created} new` : '',
        enabled ? `${enabled} re-enabled` : '',
        disabled ? `${disabled} disabled (removed from GitHub)` : '',
      ].filter(Boolean);
      setSyncNote({ ok: true, text: parts.length ? `Projects synced: ${parts.join(', ')}.` : 'Projects already match your repositories.' });
      router.refresh();
    } finally {
      setSyncing(false);
    }
  }

  const manage = appSlug ? (
    <a
      className="btn"
      href={`https://github.com/apps/${appSlug}/installations/new`}
      target="_blank"
      rel="noreferrer noopener"
    >
      Add or remove repositories ↗
    </a>
  ) : null;

  if (projects.length === 0) {
    return github ? (
      <SetupCard
        title="No repositories yet"
        detail="Each repository the AgentSync GitHub App is installed on becomes a project. Add repositories on GitHub, then sync."
      >
        <div className="flex flex-wrap gap-2">
          {manage}
          <button className="btn-primary" onClick={sync} disabled={syncing}>
            {syncing ? 'Syncing…' : 'Sync from GitHub'}
          </button>
        </div>
        {syncNote ? (
          <div className={`text-[13.5px] ${syncNote.ok ? 'text-ok-ink' : 'text-danger-ink'}`}>{syncNote.text}</div>
        ) : null}
      </SetupCard>
    ) : (
      <SetupCard
        title="Connect GitHub to create projects"
        detail="Each repository you install the AgentSync GitHub App on becomes a project automatically, with plan and merge approval switched on."
      >
        <button className="btn-primary w-fit" onClick={onConnect}>Connect GitHub</button>
      </SetupCard>
    );
  }

  const project = projects.find((p) => p.id === selected) ?? projects[0];
  const groups = groupsFor(project);
  const g = groups[Math.min(group, groups.length - 1)];
  const repoName = (p: ProjectRecord) =>
    p.repository?.github_owner && p.repository?.repository ? `${p.repository.github_owner}/${p.repository.repository}` : p.slug;
  const shownProjects = projects.filter((p) => {
    const q = filterText.trim().toLowerCase();
    return !q || `${p.name} ${repoName(p)}`.toLowerCase().includes(q);
  });
  const tier = tiers?.projects[project.id] ?? 'medium';
  if (summaryFor !== project.id) {
    // A different project: its counts arrive when its description loads.
    setSummaryFor(project.id);
    setSummary(null);
  }
  const TAB_LIST: { k: ProjectTab; label: string }[] = [
    { k: 'description', label: 'Description' },
    { k: 'history', label: `History${summary?.versions ? ` · ${summary.versions}` : ''}` },
    { k: 'releases', label: 'Releases' },
    { k: 'map', label: 'Code map' },
    { k: 'settings', label: 'Settings' },
    { k: 'request', label: 'New request' },
  ];

  return (
    <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
      {/* ---- the project list ---- */}
      <section aria-label="Projects" className="card flex shrink-0 flex-col overflow-hidden xl:sticky xl:top-0 xl:w-[300px]">
        <div className="flex flex-col gap-2.5 border-b border-line-soft p-3.5">
          <label className="flex h-9 items-center gap-2 rounded-lg border border-line-soft bg-raised px-2.5 text-muted-3">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
            <span className="sr-only">Filter projects</span>
            <input
              type="search"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder={`Filter ${projects.length} project${projects.length === 1 ? '' : 's'}`}
              className="min-w-0 flex-1 border-0 bg-transparent text-[13.5px] text-ink outline-none"
            />
          </label>
        </div>
        <div className="max-h-[420px] overflow-y-auto xl:max-h-[calc(100vh-260px)]">
          {shownProjects.map((p) => {
            const on = p.id === project.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => { onSelect(p.id); onGroup(0); }}
                aria-current={on ? 'true' : undefined}
                className={`flex w-full cursor-pointer flex-col gap-1 border-b border-line-faint px-4 py-3 text-left ${on ? 'bg-raised shadow-[inset_3px_0_0_var(--color-ink)]' : 'hover:bg-raised'}`}
              >
                <span className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full" style={{ background: p.enabled ? 'var(--color-ok)' : 'var(--color-muted-4)' }} />
                  <span className="flex-1 truncate text-[14px] font-semibold">{p.name}</span>
                  {Number(p.spend) > 0 ? <span className="text-[12px] text-muted-3 tabular-nums">${Number(p.spend).toFixed(2)}</span> : null}
                </span>
                <span className="mono truncate pl-3.5 text-[12px] text-muted-3">{repoName(p)}</span>
                {!p.enabled ? <span className="pl-3.5 text-[12px] text-muted-3">Not in the GitHub installation</span> : null}
              </button>
            );
          })}
          {shownProjects.length === 0 ? <div className="px-4 py-4 text-[13.5px] text-muted-3">No project matches.</div> : null}
        </div>
        <div className="flex flex-col gap-2 border-t border-line-soft p-3.5">
          {github ? (
            <button className="btn w-full" onClick={sync} disabled={syncing}>
              {syncing ? 'Syncing…' : 'Sync from GitHub'}
            </button>
          ) : null}
          {appSlug ? (
            <a
              className="text-center text-[13px] text-agent-ink"
              href={`https://github.com/apps/${appSlug}/installations/new`}
              target="_blank"
              rel="noreferrer noopener"
            >
              Add or remove repositories ↗
            </a>
          ) : null}
          {syncNote ? (
            <div className={`text-[13px] ${syncNote.ok ? 'text-ok-ink' : 'text-danger-ink'}`}>{syncNote.text}</div>
          ) : null}
        </div>
      </section>

      {/* ---- one project ---- */}
      <section aria-label={project.name} className="card min-w-0 flex-1 overflow-hidden">
        <div className="flex flex-col gap-3 px-5 pt-5 sm:px-7">
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="m-0 text-[22px] font-semibold tracking-[-0.02em]">{project.name}</h2>
                <Pill c={project.enabled ? ['var(--color-ok-tint)', 'var(--color-ok-ink)'] : ['var(--color-line-faint)', 'var(--color-muted-2)']}>
                  {project.enabled ? 'Active' : 'Disabled'}
                </Pill>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-3">
                <span className="mono">{repoName(project)}</span>
                <span>
                  Released{' '}
                  <strong className="font-semibold text-ink tabular-nums">{summary?.release ? `v${summary.release}` : 'nothing yet'}</strong>
                </span>
                {project.repository?.default_branch ? (
                  <span>Default branch <span className="mono">{project.repository.default_branch}</span></span>
                ) : null}
                <span title="Use this id when a source system submits work for this project">
                  Project id <span className="mono select-all text-ink-3">{project.id.slice(0, 8)}…</span>
                </span>
              </div>
            </div>
            <button className="btn-primary" onClick={() => setTab('request')} disabled={!project.enabled}>
              New request
            </button>
          </div>
          <div className="-mx-5 border-b border-line-soft px-1 sm:-mx-7 sm:px-3">
            <Tabs tabs={TAB_LIST} active={tab} onSelect={setTab} />
          </div>
        </div>

        <div className="px-5 py-5 sm:px-7">
          {tab === 'description' || tab === 'history' || tab === 'releases' || tab === 'map' ? (
            <ProjectDocs
              key={`docs:${project.id}`}
              projectId={project.id}
              tenantSlug={tenantSlug}
              onOpenTask={onOpenTask}
              tab={tab}
              onTab={setTab}
              bare
              onSummary={setSummary}
            />
          ) : null}

          {tab === 'request' ? (
            <RequestForm
              key={`${project.id}:${tier}`}
              defaultTier={tier}
              projectId={project.id}
              repository={repoName(project)}
              enabled={project.enabled}
              canSubmit={canSubmit}
              onSubmitted={onSubmitted}
            />
          ) : null}

          {tab === 'settings' ? (
            <div className="flex flex-col gap-4">
              <ProjectDatabase projectId={project.id} />

              <div className="flex flex-col gap-3 rounded-[10px] border border-line-soft p-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-[15px] font-semibold text-ink">Default size</div>
                  <div className="text-[13.5px] text-muted-3">
                    Which models the agents use for this project&apos;s requests, unless a request picks another.
                  </div>
                </div>
                <TierPicker
                  value={tier}
                  disabled={!tiers?.can_edit}
                  onChange={(t) => void setProjectTier(project.id, t)}
                />
              </div>

              <div className="flex flex-col gap-3 rounded-[10px] border border-line-soft p-5">
                <div>
                  <div className="text-[15px] font-semibold text-ink">Where the Engineer writes code</div>
                  <div className="text-[13.5px] text-muted-3">Checked against the plan before any pull request, whichever you choose.</div>
                </div>
                <div role="radiogroup" aria-label="Engineer mode" className="grid grid-cols-1 gap-2 md:grid-cols-3">
                  {([
                    ['sandbox', 'Claude sandbox', 'Clones the repository, runs install, lint, tests and build, fixes what fails, then pushes. Recommended.'],
                    ['openai_sandbox', 'OpenAI sandbox', 'The same job in OpenAI’s container. Needs an OpenAI key.'],
                    ['direct', 'Direct', 'One model call writes the planned files; only your GitHub Actions check them. Cheaper.'],
                  ] as const).map(([m, name, does]) => {
                    const active = (tiers?.engineer_modes?.[project.id] ?? 'sandbox') === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        disabled={!tiers?.can_edit}
                        onClick={() => void setEngineerMode(project.id, m)}
                        className={`flex cursor-pointer flex-col items-start gap-1 rounded-lg border p-3 text-left disabled:cursor-default ${
                          active ? 'border-ink bg-raised shadow-[0_0_0_1px_var(--color-ink)]' : 'border-line-soft hover:border-line-strong'
                        }`}
                      >
                        <span className="text-[13.5px] font-semibold">{name}</span>
                        <span className="text-[12.5px] leading-snug text-muted-3">{does}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="flex cursor-pointer items-start gap-3 rounded-[10px] border border-line-soft p-5">
                <input
                  type="checkbox"
                  className="mt-1 size-4 accent-[var(--color-ink)]"
                  checked={Boolean(tiers?.failover?.[project.id])}
                  disabled={!tiers?.can_edit}
                  onChange={(e) => void setFailover(project.id, e.target.checked)}
                />
                <span className="flex flex-col gap-1">
                  <span className="text-[15px] font-semibold text-ink">Fail over to the other provider</span>
                  <span className="max-w-[70ch] text-[13.5px] leading-relaxed text-muted-3">
                    If a Claude call fails with a rate limit, timeout or server error, retry that step on OpenAI (and the other way
                    round). Both keys must be set under Connections.
                  </span>
                </span>
              </label>

              <div className="overflow-hidden rounded-[10px] border border-line-soft">
                <div className="border-b border-line-soft">
                  <Tabs
                    tabs={groups.map((pg, i) => ({ k: String(i), label: pg.title }))}
                    active={String(Math.min(group, groups.length - 1))}
                    onSelect={(k) => onGroup(Number(k))}
                  />
                </div>
                <div className="p-4">
                  {g.rows.length === 0 ? (
                    <div className="text-[14px] leading-relaxed text-muted-3">{g.missing ?? 'Nothing configured.'}</div>
                  ) : (
                    <FieldRows prefix={`project.${project.id}.${g.title}`} rows={g.rows} />
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

export { Project_ as Project };

/* ---- source systems -------------------------------------------------- */


export function Sources({ sources, tenantSlug }: { sources: SourceRow[]; tenantSlug: string | null }) {
  const [openSource, setOpenSource] = useState<string | null>(sources.length === 1 ? sources[0].id : null);
  const issue = (
    <SetupCard
      title={sources.length === 0 ? 'Connect your first source' : 'Connect another source'}
      detail="A source system is anything allowed to send work — a service desk, an intake form, a scheduled job. Its key is shown once; only a hash is kept."
    >
      <IssueKeyForm tenantSlug={tenantSlug} />
    </SetupCard>
  );
  if (sources.length === 0) return issue;

  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-[14px] text-muted-3">
        Systems that send work to AgentSync, and which repository each of their clients’ requests goes to.
      </p>
      {sources.map((s) => {
        const open = openSource === s.id;
        const facts: [string, React.ReactNode][] = [
          ['Key', <span key="k" className="mono">{s.api_key_prefix}…</span>],
          ['Allowed from', s.ip_allowlist.length ? s.ip_allowlist.join(', ') : 'Any address'],
          ['Rate limit', `${s.rate_limit_per_minute} a minute`],
          ['Tasks sent', String(s.task_count)],
        ];
        return (
          <section key={s.id} aria-label={s.name} className="card overflow-hidden">
            <div className="flex flex-wrap items-center gap-3.5 border-b border-line-soft px-5 py-4">
              <span aria-hidden="true" className="flex size-9 items-center justify-center rounded-lg border border-line-soft bg-raised text-[13px] font-bold">
                {s.name.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase()}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h2 className="m-0 text-[16px] font-semibold">{s.name}</h2>
                  <Pill c={swatch(STATE_COLOUR, s.state)}>{s.state}</Pill>
                </div>
                <span className="text-[13px] text-muted-3">
                  Last request <Ago iso={s.last_used_at} /> ago
                </span>
              </div>
              <button
                className={open ? 'btn' : 'btn-primary'}
                onClick={() => setOpenSource(open ? null : s.id)}
                aria-expanded={open}
              >
                {open ? 'Hide clients' : 'Clients and repositories'}
              </button>
            </div>
            <dl className="m-0 grid grid-cols-2 lg:grid-cols-4">
              {facts.map(([k, v], i) => (
                <div key={k} className={`flex flex-col gap-1 px-5 py-3.5 ${i > 0 ? 'lg:border-l' : ''} ${i % 2 ? 'border-l lg:border-l' : ''} border-line-soft`}>
                  <dt className="text-[12px] text-muted-3">{k}</dt>
                  <dd className="m-0 truncate text-[14px] font-medium">{v}</dd>
                </div>
              ))}
            </dl>
            {open ? (
              <div className="border-t border-line-soft p-4">
                <SourceClients key={s.id} sourceId={s.id} sourceName={s.name} tenantSlug={tenantSlug} />
              </div>
            ) : null}
          </section>
        );
      })}
      {issue}
    </div>
  );
}

/* ---- usage ----------------------------------------------------------- */
