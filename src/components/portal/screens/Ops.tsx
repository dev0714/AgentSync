'use client';

import type {
  ApprovalRow,
  AuditRow,
  DeploymentRow,
} from '@/lib/portal-data';
import {
  DEPLOYMENT_STATUS_COLOUR,
  ENVIRONMENT_COLOUR,
  GATE_COLOUR,
  clock,
  duration,
  eventColour,
  swatch,
} from '@/lib/portal-ui';
import { Ago, ColLabel, Empty, Pill, TableCard } from '../ui';

const GATE_DETAIL: Record<string, string> = {
  plan: 'The plan is written and waiting for a human before any code is touched.',
  merge: 'The branch is pushed and validated. Nothing has reached the default branch.',
  production: 'A production deployment is held at the gate.',
  information: 'The agent stopped and asked a question rather than guessing.',
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
        title="No gate is open"
        detail="Approvals appear here when a task reaches a gate the project is configured to hold — plan, merge or production. Nothing is waiting on a person right now."
        table="agentsync.task_approvals"
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="text-[12.5px] text-muted" style={{ lineHeight: 1.6 }}>
        Every gate the platform is holding. Nothing below has touched a
        protected branch or a production deployment.
      </div>
      {approvals.map((ap) => (
        <div
          key={ap.id}
          className="card flex flex-col items-start gap-4 p-4 lg:flex-row lg:items-center"
        >
          <div className="min-w-0 flex-1">
            <div className="mb-1.5 flex flex-wrap items-center gap-2.5">
              <Pill c={swatch(GATE_COLOUR, ap.gate)}>{ap.gate}</Pill>
              <span className="mono text-[11px] font-medium text-accent">
                {ap.reference}
              </span>
              <span className="mono text-[10.5px] text-muted-2">
                waiting <Ago iso={ap.requested_at} />
              </span>
              {ap.project ? (
                <span className="mono text-[10.5px] text-muted-3">
                  {ap.project}
                </span>
              ) : null}
            </div>
            <div className="mb-1 text-[14px] font-semibold tracking-[-0.01em]">
              {ap.title}
            </div>
            <div className="text-[12px] text-muted" style={{ lineHeight: 1.5 }}>
              {GATE_DETAIL[ap.gate] ?? `Task status: ${ap.status}`}
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn" onClick={() => onOpen(ap.task_id)}>
              Review
            </button>
          </div>
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
        <ColLabel>URL / BRANCH</ColLabel>
        <ColLabel>COMMIT</ColLabel>
        <ColLabel>STATUS</ColLabel>
        <ColLabel>BUILD</ColLabel>
        <ColLabel right>STARTED</ColLabel>
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
            <div className="mono truncate text-[11.5px] text-ink-2">
              {dp.url ?? '—'}
            </div>
            <div className="mono truncate text-[10.5px] text-muted-2">
              {dp.branch ?? '—'}
            </div>
          </div>
          <span className="mono text-[10.5px] text-muted">
            {dp.commit_sha ? dp.commit_sha.slice(0, 7) : '—'}
          </span>
          <div>
            <Pill c={swatch(DEPLOYMENT_STATUS_COLOUR, dp.status)}>
              {dp.status}
            </Pill>
          </div>
          <span className="mono text-[10.5px] text-muted">
            {duration(dp.build_duration_seconds)}
          </span>
          <span className="mono text-right text-[10.5px] text-muted-2">
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
          <div className="label">TENANT-SCOPED · APPEND-ONLY · RLS ENFORCED</div>
          <div className="flex-1" />
          <div className="mono text-[10.5px] text-muted-2">
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
            <span className="mono text-[10.5px] text-muted-2">
              {clock(al.created_at)}
            </span>
            <span
              className="mono text-[11px]"
              style={{ color: eventColour(al.event_type) }}
            >
              {al.event_type}
            </span>
            <span className="mono text-[11px] text-muted">
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
