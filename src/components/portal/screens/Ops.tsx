'use client';

import type {
  ApprovalRow,
  AuditRow,
  DeploymentRow,
} from '@/lib/portal-data';
import {
  DEPLOYMENT_STATUS_COLOUR,
  ENVIRONMENT_COLOUR,
  clock,
  duration,
  eventColour,
  swatch,
} from '@/lib/portal-ui';
import { Ago, ColLabel, Empty, Pill, TableCard } from '../ui';

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
  'grid min-w-[900px] grid-cols-[110px_minmax(260px,1fr)_100px_170px_90px_80px] items-center gap-3';

export function Deployments({ deployments }: { deployments: DeploymentRow[] }) {
  if (deployments.length === 0) {
    return (
      <Empty
        title="Nothing has been deployed"
        detail="Preview and production deployments are recorded here once a deployment provider is connected and a task reaches the pull-request stage."
        table="agentsync.deployments"
      />
    );
  }

  return (
    <TableCard>
      <div className={`${DEP_GRID} border-b border-line bg-raised px-3.5 py-[9px]`}>
        <ColLabel>ENV</ColLabel>
        <ColLabel>URL / branch</ColLabel>
        <ColLabel>Commit</ColLabel>
        <ColLabel>Status</ColLabel>
        <ColLabel>Build</ColLabel>
        <ColLabel right>Started</ColLabel>
      </div>
      {deployments.map((dp) => (
        <div
          key={dp.id}
          className={`${DEP_GRID} border-b border-line-faint px-3.5 py-[11px]`}
        >
          <div>
            <Pill c={swatch(ENVIRONMENT_COLOUR, dp.environment)}>
              {dp.environment}
            </Pill>
          </div>
          <div className="min-w-0">
            <div className="mono truncate text-[13px] text-ink-2">
              {dp.url ?? '—'}
            </div>
            <div className="mono truncate text-[12px] text-muted-2">
              {dp.branch ?? '—'}
            </div>
          </div>
          <span className="mono text-[12px] text-muted">
            {dp.commit_sha ? dp.commit_sha.slice(0, 7) : '—'}
          </span>
          <div>
            <Pill c={swatch(DEPLOYMENT_STATUS_COLOUR, dp.status)}>
              {dp.status}
            </Pill>
          </div>
          <span className="mono text-[12px] text-muted">
            {duration(dp.build_duration_seconds)}
          </span>
          <span className="mono text-right text-[12px] text-muted-2">
            <Ago iso={dp.started_at} />
          </span>
        </div>
      ))}
    </TableCard>
  );
}

export function Audit({ audit }: { audit: AuditRow[] }) {
  if (audit.length === 0) {
    return (
      <Empty
        title="The audit log is empty"
        detail="Every status change, approval, tool denial and limit breach is written here as it happens. The table is append-only — the portal has no privilege to update or delete a row."
        table="agentsync.task_events"
      />
    );
  }

  return (
    <TableCard
      head={
        <div className="flex items-center gap-3 border-b border-line px-3.5 py-[11px]">
          <div className="label">Scoped to this tenant · entries can’t be changed</div>
          <div className="flex-1" />
          <div className="mono text-[12px] text-muted-2">
            LAST {audit.length}
          </div>
        </div>
      }
    >
      <div className="min-w-[860px]">
        {audit.map((al) => (
          <div
            key={al.id}
            className="grid grid-cols-[76px_220px_1fr] items-baseline gap-3 border-b border-line-faint px-3.5 py-2.5"
          >
            <span className="mono text-[12px] text-muted-2">
              {clock(al.created_at)}
            </span>
            <span
              className="mono text-[12.5px]"
              style={{ color: eventColour(al.event_type) }}
            >
              {al.event_type}
            </span>
            <span className="mono text-[12.5px] text-muted">
              {al.message ?? ''}
              {al.actor ? (
                <span className="text-muted-3"> · {al.actor}</span>
              ) : null}
            </span>
          </div>
        ))}
      </div>
    </TableCard>
  );
}
