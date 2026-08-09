'use client';

import {
  APPROVALS,
  AUDIT_LINES,
  DEPLOYMENTS,
  type DetailTab,
} from '@/data/portal';
import { ColLabel, Pill, TableCard } from '../ui';

export function Approvals({
  onOpen,
}: {
  onOpen: (tab: DetailTab) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="text-[12.5px] text-muted" style={{ lineHeight: 1.6 }}>
        Every gate the platform is configured to hold. Nothing below has touched
        a protected branch or a production deployment.
      </div>
      {APPROVALS.map((ap) => (
        <div
          key={ap.ref}
          className="card flex flex-col items-start gap-4 p-4 lg:flex-row lg:items-center"
        >
          <div className="min-w-0 flex-1">
            <div className="mb-1.5 flex flex-wrap items-center gap-2.5">
              <Pill c={ap.gateC}>{ap.gate}</Pill>
              <span className="mono text-[11px] font-medium text-accent">
                {ap.ref}
              </span>
              <span className="mono text-[10.5px] text-muted-2">
                waiting {ap.waiting}
              </span>
            </div>
            <div className="mb-1 text-[14px] font-semibold tracking-[-0.01em]">
              {ap.title}
            </div>
            <div className="text-[12px] text-muted" style={{ lineHeight: 1.5 }}>
              {ap.detail}
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn" onClick={() => onOpen(ap.tab)}>
              Review
            </button>
            <button className="btn-primary">Approve</button>
          </div>
        </div>
      ))}
    </div>
  );
}

const DEP_GRID =
  'grid min-w-[900px] grid-cols-[110px_minmax(260px,1fr)_100px_170px_90px_80px] items-center gap-3';

export function Deployments() {
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
      {DEPLOYMENTS.map((dp) => (
        <div
          key={dp.url + dp.commit}
          className={`${DEP_GRID} border-b border-line-faint px-3.5 py-[11px]`}
        >
          <div>
            <Pill c={dp.envC}>{dp.env}</Pill>
          </div>
          <div className="min-w-0">
            <div className="mono truncate text-[11.5px] text-ink-2">
              {dp.url}
            </div>
            <div className="mono truncate text-[10.5px] text-muted-2">
              {dp.branch}
            </div>
          </div>
          <span className="mono text-[10.5px] text-muted">{dp.commit}</span>
          <div>
            <Pill c={dp.c}>{dp.status}</Pill>
          </div>
          <span className="mono text-[10.5px] text-muted">{dp.build}</span>
          <span className="mono text-right text-[10.5px] text-muted-2">
            {dp.started}
          </span>
        </div>
      ))}
    </TableCard>
  );
}

export function Audit() {
  return (
    <TableCard
      head={
        <div className="flex items-center gap-3 border-b border-line px-3.5 py-[11px]">
          <div className="label">TENANT-SCOPED · IMMUTABLE · RLS ENFORCED</div>
          <div className="flex-1" />
          <div className="mono text-[10.5px] text-muted-2">LAST 24H</div>
        </div>
      }
    >
      <div className="min-w-[860px]">
        {AUDIT_LINES.map((al, i) => (
          <div
            key={`${al.time}-${i}`}
            className="grid grid-cols-[76px_220px_1fr] items-baseline gap-3 border-b border-line-faint px-3.5 py-2.5"
          >
            <span className="mono text-[10.5px] text-muted-2">{al.time}</span>
            <span className="mono text-[11px]" style={{ color: al.typeColor }}>
              {al.type}
            </span>
            <span className="mono text-[11px] text-muted">{al.detail}</span>
          </div>
        ))}
      </div>
    </TableCard>
  );
}
