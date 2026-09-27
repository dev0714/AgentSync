'use client';

import type {
  ApprovalRow,
  AuditRow,
  DeploymentRow,
} from '@/lib/portal-data';
import {
  DEPLOYMENT_STATUS_COLOUR,
  clock,
  duration,
  eventColour,
  statusLabel,
  swatch,
} from '@/lib/portal-ui';
import { useState } from 'react';
import { Ago, ColLabel, Empty, Pill, Segmented, TableCard } from '../ui';

const GATE_NAME: Record<string, string> = {
  plan: 'Plan approval',
  merge: 'Merge approval',
  production: 'Release approval',
  information: 'Question',
};

const GATE_DETAIL: Record<string, string> = {
  plan: 'Approve the plan before any code is written. Approving starts the Engineer.',
  merge: 'The branch is pushed and checked. Approving merges the pull request.',
  production: 'A production release is waiting. Approving puts it live.',
  information: 'The agent stopped to ask a question rather than guess. Answer it to continue.',
};

const GATE_CTA: Record<string, string> = {
  plan: 'Review plan',
  merge: 'Review pull request',
  production: 'Review release',
  information: 'Answer',
};

export function Approvals({
  approvals,
  onOpen,
}: {
  approvals: ApprovalRow[];
  onOpen: (taskId: string) => void;
}) {
  if (approvals.length === 0) {
    return (
      <Empty
        title="Nothing needs a decision"
        detail="Tasks appear here when they reach a point your projects hold for a person: the plan, the merge or the release. Nothing is waiting right now."
        table="agentsync.task_approvals"
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-[14px] leading-relaxed text-muted-3">
        Nothing here has reached your default branch or production. Each task waits until someone decides.
      </p>
      {approvals.map((ap) => (
        <div
          key={ap.id}
          className="card flex flex-col items-start gap-4 border-[var(--color-gate-line)] p-4 sm:p-5 lg:flex-row lg:items-center"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="inline-flex h-[22px] items-center gap-1.5 rounded-[5px] bg-gate-tint px-2 text-[12px] font-semibold text-gate-ink">
                <span className="size-1.5 rounded-full bg-gate" />
                {GATE_NAME[ap.gate] ?? ap.gate}
              </span>
              <span className="mono text-[12.5px] text-muted-3">{ap.reference}</span>
              <span className="text-[12.5px] text-muted-3">
                {ap.project ? `${ap.project} · ` : ''}waiting <Ago iso={ap.requested_at} />
              </span>
            </div>
            <div className="text-[15.5px] leading-snug font-semibold">{ap.title}</div>
            <div className="text-[13.5px] leading-normal text-ink-3">
              {GATE_DETAIL[ap.gate] ?? `Task status: ${ap.status}`}
            </div>
          </div>
          <button className="btn-primary" onClick={() => onOpen(ap.task_id)}>
            {GATE_CTA[ap.gate] ?? 'Review'}
          </button>
        </div>
      ))}
    </div>
  );
}

const DEP_GRID =
  'grid min-w-[900px] grid-cols-[120px_minmax(260px,1fr)_100px_190px_90px_100px] items-center gap-4';

type EnvFilter = 'all' | 'preview' | 'production';

export function Deployments({ deployments }: { deployments: DeploymentRow[] }) {
  const [env, setEnv] = useState<EnvFilter>('all');
  if (deployments.length === 0) {
    return (
      <Empty
        title="Nothing has been deployed"
        detail="Preview and production deployments are recorded here once a deployment provider is connected and a task reaches the pull-request stage."
        table="agentsync.deployments"
      />
    );
  }
  const isProd = (d: DeploymentRow) => d.environment.toLowerCase() === 'production';
  const liveProd = deployments.find((d) => isProd(d) && d.status === 'READY') ?? null;
  const waiting = deployments.filter((d) => d.status === 'AWAITING_APPROVAL');
  const building = deployments.filter((d) => d.status === 'BUILDING' || d.status === 'QUEUED');
  const shown = deployments.filter((d) => env === 'all' || d.environment.toLowerCase() === env);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Summary
          title="Live in production"
          tone={liveProd ? 'ok' : 'off'}
          state={liveProd ? 'Ready' : 'Nothing yet'}
          line={liveProd ? <>Commit <span className="mono">{liveProd.commit_sha?.slice(0, 7) ?? '—'}</span> · <Ago iso={liveProd.finished_at ?? liveProd.started_at} /> ago</> : 'No production release has finished.'}
          url={liveProd?.url ?? null}
        />
        <Summary
          title="Waiting to release"
          tone={waiting.length ? 'gate' : 'off'}
          state={waiting.length ? `${waiting.length} waiting` : 'None'}
          line={waiting.length ? 'A person approves before it goes live.' : 'No release is held for approval.'}
          url={null}
        />
        <Summary
          title="Building now"
          tone={building.length ? 'agent' : 'off'}
          state={building.length ? `${building.length} building` : 'Idle'}
          line={building.length ? (building[0].branch ?? 'preview') : 'No build is running.'}
          url={null}
        />
      </div>

      <TableCard
        head={
          <div className="flex flex-wrap items-center gap-3 border-b border-line-soft px-4 py-3">
            <h2 className="m-0 text-[15px] font-semibold">All deployments</h2>
            <Segmented
              label="Environment"
              value={env}
              onChange={setEnv}
              options={[
                { k: 'all', label: 'All' },
                { k: 'preview', label: 'Preview' },
                { k: 'production', label: 'Production' },
              ]}
            />
            <div className="flex-1" />
            <span className="text-[12.5px] text-muted-3">{shown.length} of {deployments.length}</span>
          </div>
        }
      >
        <div className={`${DEP_GRID} border-b border-line-soft bg-raised px-4 py-[9px]`}>
          <ColLabel>Environment</ColLabel>
          <ColLabel>Address and branch</ColLabel>
          <ColLabel>Commit</ColLabel>
          <ColLabel>Status</ColLabel>
          <ColLabel>Took</ColLabel>
          <ColLabel right>Started</ColLabel>
        </div>
        {shown.map((dp) => (
          <div key={dp.id} className={`${DEP_GRID} border-b border-line-faint px-4 py-3`}>
            <span className={`text-[13.5px] ${isProd(dp) ? 'font-semibold text-ink' : 'text-muted-3'}`}>
              {isProd(dp) ? 'Production' : dp.environment.charAt(0).toUpperCase() + dp.environment.slice(1)}
            </span>
            <div className="min-w-0">
              {dp.url ? (
                <a href={dp.url} target="_blank" rel="noreferrer" className="mono block truncate text-[12.5px] text-agent-ink">
                  {dp.url.replace(/^https?:\/\//, '')}
                </a>
              ) : (
                <span className="mono text-[12.5px] text-muted-3">—</span>
              )}
              <div className="mono truncate text-[12px] text-muted-3">{dp.branch ?? '—'}</div>
            </div>
            <span className="mono text-[12.5px] text-muted-3">{dp.commit_sha ? dp.commit_sha.slice(0, 7) : '—'}</span>
            <div>
              <Pill c={swatch(DEPLOYMENT_STATUS_COLOUR, dp.status)}>
                {dp.status === 'AWAITING_APPROVAL' ? 'Waiting for approval' : dp.status}
              </Pill>
            </div>
            <span className="text-[13px] text-muted-3 tabular-nums">{duration(dp.build_duration_seconds)}</span>
            <span className="text-right text-[12.5px] text-muted-3">
              <Ago iso={dp.started_at} /> ago
            </span>
          </div>
        ))}
        {shown.length === 0 ? <div className="px-4 py-6 text-[14px] text-muted-3">Nothing in this environment.</div> : null}
      </TableCard>
    </div>
  );
}

const TONES: Record<string, [string, string, string]> = {
  ok: ['var(--color-ok-tint)', 'var(--color-ok-ink)', 'var(--color-ok)'],
  gate: ['var(--color-gate-tint)', 'var(--color-gate-ink)', 'var(--color-gate)'],
  agent: ['var(--color-agent-tint)', 'var(--color-agent-ink)', 'var(--color-accent)'],
  off: ['var(--color-line-faint)', 'var(--color-ink-3)', 'var(--color-muted-4)'],
};

function Summary({ title, tone, state, line, url }: { title: string; tone: string; state: string; line: React.ReactNode; url: string | null }) {
  const [bg, fg, dot] = TONES[tone];
  return (
    <div className="card flex flex-col gap-2 p-4">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-[14px] font-semibold">{title}</span>
        <span className="inline-flex h-[22px] items-center gap-1.5 rounded-[5px] px-2 text-[12px] font-medium" style={{ background: bg, color: fg }}>
          <span className="size-1.5 rounded-full" style={{ background: dot }} />
          {state}
        </span>
      </div>
      <span className="truncate text-[13px] text-muted-3">{line}</span>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="mono truncate text-[12.5px] text-agent-ink">
          {url.replace(/^https?:\/\//, '')}
        </a>
      ) : null}
    </div>
  );
}

type Who = 'all' | 'person' | 'agent' | 'system';

/** Who wrote an entry: a person (an email), an agent or worker, or a system. */
function whoOf(actor: string | null): Exclude<Who, 'all'> {
  const a = (actor ?? '').toLowerCase();
  if (a.includes('@')) return 'person';
  if (/^(worker|agent|planner|engineer|reviewer|analyst|router)/.test(a) || a.includes('agent')) return 'agent';
  return 'system';
}

const WHO_NAME = { person: 'Person', agent: 'Agent', system: 'System' };

export function Audit({ audit }: { audit: AuditRow[] }) {
  const [who, setWho] = useState<Who>('all');
  const [q, setQ] = useState('');
  if (audit.length === 0) {
    return (
      <Empty
        title="The audit log is empty"
        detail="Every status change, approval, tool denial and limit breach is written here as it happens. Entries can’t be edited or deleted."
        table="agentsync.task_events"
      />
    );
  }
  const needle = q.trim().toLowerCase();
  const shown = audit.filter((al) =>
    (who === 'all' || whoOf(al.actor) === who) &&
    (!needle || `${al.event_type} ${al.message ?? ''} ${al.actor ?? ''}`.toLowerCase().includes(needle)));
  const count = (k: Exclude<Who, 'all'>) => audit.filter((al) => whoOf(al.actor) === k).length;

  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-[14px] text-muted-3">
        Everything that changed in this tenant, who or what did it, and when. Entries can’t be edited or deleted.
      </p>
      <TableCard
        head={
          <div className="flex flex-wrap items-center gap-3 border-b border-line-soft px-4 py-3">
            <label className="flex h-9 w-full max-w-[320px] items-center gap-2 rounded-lg border border-line-soft bg-card px-2.5 text-muted-3">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
              <span className="sr-only">Search the log</span>
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search what happened or who"
                className="min-w-0 flex-1 border-0 bg-transparent text-[13.5px] text-ink outline-none"
              />
            </label>
            <Segmented
              label="Who"
              value={who}
              onChange={setWho}
              options={[
                { k: 'all', label: 'Everyone' },
                { k: 'person', label: 'People', count: count('person') },
                { k: 'agent', label: 'Agents', count: count('agent') },
                { k: 'system', label: 'Systems', count: count('system') },
              ]}
            />
            <div className="flex-1" />
            <span className="text-[12.5px] text-muted-3">Latest {audit.length} entries</span>
          </div>
        }
      >
        <div className="min-w-[860px]">
          <div className="grid grid-cols-[130px_200px_minmax(0,1fr)_200px] gap-4 border-b border-line-soft bg-raised px-4 py-[9px]">
            <ColLabel>When</ColLabel>
            <ColLabel>Who</ColLabel>
            <ColLabel>What happened</ColLabel>
            <ColLabel>Kind</ColLabel>
          </div>
          {shown.map((al) => {
            const kind = whoOf(al.actor);
            const name = al.actor ?? 'System';
            return (
              <div key={al.id} className="grid grid-cols-[130px_200px_minmax(0,1fr)_200px] items-center gap-4 border-b border-line-faint px-4 py-2.5">
                <span className="text-[12.5px] text-muted-3 tabular-nums" title={al.created_at}>
                  {new Date(al.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} {clock(al.created_at).slice(0, 5)}
                </span>
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={`flex size-6 shrink-0 items-center justify-center text-[10.5px] font-semibold ${kind === 'person' ? 'rounded-full' : 'rounded-md'} ${kind === 'agent' ? 'bg-agent-tint text-agent-ink' : 'bg-line-faint text-ink-3'}`}
                  >
                    {name.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '··'}
                  </span>
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="truncate text-[13px] font-medium">{name}</span>
                    <span className="text-[11.5px] text-muted-3">{WHO_NAME[kind]}</span>
                  </span>
                </span>
                <span className="truncate text-[13.5px] text-ink-3" title={al.message ?? ''}>
                  {al.message || statusLabel(al.event_type)}
                </span>
                <span className="mono truncate text-[12px]" style={{ color: eventColour(al.event_type) }}>
                  {al.event_type}
                </span>
              </div>
            );
          })}
          {shown.length === 0 ? <div className="px-4 py-6 text-[14px] text-muted-3">No entry matches.</div> : null}
        </div>
      </TableCard>
    </div>
  );
}
