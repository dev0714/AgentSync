'use client';

import type {
  Project as ProjectRecord,
  SourceRow,
  Usage as UsageTotals,
} from '@/lib/portal-data';
import {
  ACCENT,
  STATE_COLOUR,
  compact,
  money,
  rowsFrom,
  swatch,
  type Row,
} from '@/lib/portal-ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Ago, Bar, ColLabel, FieldRows, Pill, TableCard, Tabs } from '../ui';
import RequestForm from './RequestForm';
import { IssueKeyForm } from './SetupForms';

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
}: {
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
  const appSlug = typeof github?.app_slug === 'string' ? github.app_slug : null;

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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        {projects.length > 1 ? (
          <select
            className="field-select !w-auto"
            value={project.id}
            onChange={(e) => {
              onSelect(e.target.value);
              onGroup(0);
            }}
            aria-label="Project"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.repository?.github_owner
                  ? `${p.repository.github_owner}/${p.repository.repository}`
                  : p.name}
                {p.enabled ? '' : ' (disabled)'}
              </option>
            ))}
          </select>
        ) : (
          <div className="text-[20px] font-semibold tracking-[-0.02em]">
            {project.name}
          </div>
        )}
        <Pill c={project.enabled ? ['#DDEFE3', '#17603C'] : ['#F0ECE3', '#5B5D66']}>
          {project.enabled ? 'Active' : 'Disabled — not in the GitHub installation'}
        </Pill>
        <span className="mono text-[12.5px] text-muted-2">
          {project.repository?.github_owner && project.repository?.repository
            ? `${project.repository.github_owner}/${project.repository.repository}`
            : project.slug}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          {manage}
          {github ? (
            <button className="btn" onClick={sync} disabled={syncing}>
              {syncing ? 'Syncing…' : 'Sync from GitHub'}
            </button>
          ) : null}
        </div>
      </div>
      {syncNote ? (
        <div className={`text-[13.5px] ${syncNote.ok ? 'text-ok-ink' : 'text-danger-ink'}`}>{syncNote.text}</div>
      ) : null}
      <div className="text-[13px] text-muted-2">
        Project ID for submissions: <span className="mono select-all text-ink-2">{project.id}</span>
      </div>

      <RequestForm
        key={project.id}
        projectId={project.id}
        repository={
          project.repository?.github_owner
            ? `${project.repository.github_owner}/${project.repository.repository}`
            : project.name
        }
        enabled={project.enabled}
        canSubmit={canSubmit}
        onSubmitted={onSubmitted}
      />

      <div className="card overflow-hidden">
        <div className="card-head">
          <Tabs
            tabs={groups.map((pg, i) => ({ k: String(i), label: pg.title }))}
            active={String(Math.min(group, groups.length - 1))}
            onSelect={(k) => onGroup(Number(k))}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <div className="text-[14.5px] font-semibold">{g.title}</div>
          <div className="mono text-[11.5px] text-muted-2">{g.table}</div>
        </div>
        <div className="p-4">
          {g.rows.length === 0 ? (
            <div className="text-[14px] text-muted" style={{ lineHeight: 1.6 }}>
              {g.missing ?? 'Nothing configured.'}
            </div>
          ) : (
            <FieldRows prefix={`project.${project.id}.${g.title}`} rows={g.rows} />
          )}
        </div>
      </div>
    </div>
  );
}

export { Project_ as Project };

/* ---- source systems -------------------------------------------------- */

const SRC_GRID =
  'grid min-w-[900px] grid-cols-[minmax(200px,1fr)_160px_150px_100px_90px_90px] items-center gap-3';

export function Sources({ sources, tenantSlug }: { sources: SourceRow[]; tenantSlug: string | null }) {
  const issue = (
    <SetupCard
      title={sources.length === 0 ? 'Issue your first key' : 'Issue another key'}
      detail="A source system is anything allowed to submit tasks — a service desk, an intake form, a cron job. The key is shown once; only its hash is stored."
    >
      <IssueKeyForm tenantSlug={tenantSlug} />
    </SetupCard>
  );
  if (sources.length === 0) return issue;

  return (
    <div className="flex flex-col gap-3">
      {issue}
      <div className="text-[14px] text-muted" style={{ lineHeight: 1.6 }}>
        Systems permitted to submit tasks. Keys are stored hashed; signing
        secrets live in the secret manager and are referenced by identifier
        only.
      </div>
      <TableCard>
        <div
          className={`${SRC_GRID} border-b border-line bg-raised px-3.5 py-[9px]`}
        >
          <ColLabel>SYSTEM</ColLabel>
          <ColLabel>KEY PREFIX</ColLabel>
          <ColLabel>IP ALLOWLIST</ColLabel>
          <ColLabel>RATE LIMIT</ColLabel>
          <ColLabel>TASKS</ColLabel>
          <ColLabel right>STATE</ColLabel>
        </div>
        {sources.map((s) => (
          <div
            key={s.id}
            className={`${SRC_GRID} border-b border-line-faint px-3.5 py-[11px]`}
          >
            <div className="min-w-0">
              <div className="truncate text-[14.5px] font-medium">{s.name}</div>
              <div className="mono text-[12px] text-muted-2">
                last used <Ago iso={s.last_used_at} />
              </div>
            </div>
            <span className="mono text-[12.5px] text-ink-2">
              {s.api_key_prefix}…
            </span>
            <span className="mono text-[12px] text-muted">
              {s.ip_allowlist.length ? s.ip_allowlist.join(', ') : 'any'}
            </span>
            <span className="mono text-[12px] text-muted">
              {s.rate_limit_per_minute}/min
            </span>
            <span className="mono text-[12px] text-muted">{s.task_count}</span>
            <div className="text-right">
              <Pill c={swatch(STATE_COLOUR, s.state)}>{s.state}</Pill>
            </div>
          </div>
        ))}
      </TableCard>
    </div>
  );
}

/* ---- usage ----------------------------------------------------------- */

export function Usage_({
  usage,
  projects,
}: {
  usage: UsageTotals;
  projects: ProjectRecord[];
}) {
  const spending = projects.filter((p) => Number(p.spend) > 0);
  const peak = Math.max(...spending.map((p) => Number(p.spend)), 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'SPEND · THIS MONTH', value: money(usage.month_cost), sub: usage.budget > 0 ? `of ${money(usage.budget)} budgeted` : 'no budget set' },
          { label: 'INPUT TOKENS', value: compact(usage.month_input_tokens), sub: 'this month' },
          { label: 'OUTPUT TOKENS', value: compact(usage.month_output_tokens), sub: 'this month' },
          { label: 'FAILOVER CALLS', value: String(usage.failover_calls), sub: 'served by the fallback model' },
        ].map((uc) => (
          <div key={uc.label} className="card flex flex-col gap-[7px] px-[15px] py-3.5">
            <div className="label">{uc.label}</div>
            <div className="text-2xl leading-none font-semibold tracking-[-0.02em]">
              {uc.value}
            </div>
            <div className="text-[12.5px] text-muted">{uc.sub}</div>
          </div>
        ))}
      </div>

      <div className="card p-4">
        <div className="mb-3.5 text-[14.5px] font-semibold">
          Spend by project · current month
        </div>
        {spending.length === 0 ? (
          <div className="text-[14px] text-muted" style={{ lineHeight: 1.6 }}>
            No model calls have been billed to this tenant yet. Every call a
            worker makes is recorded per task and per agent, so this fills in as
            soon as work runs.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {spending.map((p) => (
              <div
                key={p.id}
                className="grid grid-cols-[minmax(140px,200px)_1fr_80px_60px] items-center gap-3"
              >
                <div className="truncate text-[14px]">{p.name}</div>
                <Bar
                  pct={`${peak > 0 ? Math.round((Number(p.spend) / peak) * 100) : 0}%`}
                  color={ACCENT}
                  height={6}
                />
                <div className="mono text-right text-[12.5px] text-ink-2">
                  {money(p.spend)}
                </div>
                <div className="mono text-[12px] text-muted-2">
                  {p.monthly_ai_budget ? money(p.monthly_ai_budget) : '—'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export { Usage_ as Usage };
