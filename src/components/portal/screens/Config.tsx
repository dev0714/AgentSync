'use client';

import {
  PROJECT_GROUPS,
  SOURCES,
  SPEND_ROWS,
  USAGE_CARDS,
} from '@/data/portal';
import { Bar, ColLabel, FieldRows, Pill, TableCard, Tabs } from '../ui';

export function Project({
  group,
  onGroup,
}: {
  group: number;
  onGroup: (i: number) => void;
}) {
  const g = PROJECT_GROUPS[Math.min(group, PROJECT_GROUPS.length - 1)];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="text-[18px] font-semibold tracking-[-0.02em]">
          Customer Portal
        </div>
        <Pill c={['#122E1E', '#6FD69C']}>ACTIVE</Pill>
        <span className="mono text-[11px] text-muted-2">
          northwind / customer-portal
        </span>
        <div className="flex-1" />
        <button className="btn">Disable agent</button>
      </div>

      <div className="card overflow-hidden">
        <div className="card-head">
          <Tabs
            tabs={PROJECT_GROUPS.map((pg, i) => ({
              k: String(i),
              label: pg.title,
            }))}
            active={String(Math.min(group, PROJECT_GROUPS.length - 1))}
            onSelect={(k) => onGroup(Number(k))}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <div className="text-[13px] font-semibold">{g.title}</div>
          <div className="mono text-[10px] text-muted-2">{g.table}</div>
          <div className="flex-1" />
          <button className="btn">Revert</button>
          <button className="btn-primary">Save changes</button>
        </div>
        <div className="p-4">
          <FieldRows prefix={`project.${g.title}`} rows={g.rows} />
        </div>
      </div>
    </div>
  );
}

const SRC_GRID =
  'grid min-w-[860px] grid-cols-[minmax(220px,1fr)_160px_150px_110px_90px] items-center gap-3';

export function Sources() {
  return (
    <div className="flex flex-col gap-3">
      <div className="text-[12.5px] text-muted" style={{ lineHeight: 1.6 }}>
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
          <ColLabel>STATE</ColLabel>
        </div>
        {SOURCES.map((s) => (
          <div
            key={s.name}
            className={`${SRC_GRID} border-b border-line-faint px-3.5 py-[11px]`}
          >
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium">{s.name}</div>
              <div className="mono text-[10.5px] text-muted-2">{s.tenant}</div>
            </div>
            <span className="mono text-[11px] text-ink-2">{s.key}</span>
            <span className="mono text-[10.5px] text-muted">{s.ips}</span>
            <span className="mono text-[10.5px] text-muted">{s.rate}</span>
            <div>
              <Pill c={s.c}>{s.state}</Pill>
            </div>
          </div>
        ))}
      </TableCard>
    </div>
  );
}

export function Usage() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {USAGE_CARDS.map((uc) => (
          <div key={uc.label} className="card flex flex-col gap-[7px] px-[15px] py-3.5">
            <div className="label">{uc.label}</div>
            <div className="text-2xl leading-none font-semibold tracking-[-0.02em]">
              {uc.value}
            </div>
            <div className="text-[11px] text-muted">{uc.sub}</div>
          </div>
        ))}
      </div>

      <div className="card p-4">
        <div className="mb-3.5 text-[13px] font-semibold">
          Spend by project · current month
        </div>
        <div className="flex flex-col gap-3">
          {SPEND_ROWS.map((sp) => (
            <div
              key={sp.name}
              className="grid grid-cols-[minmax(140px,200px)_1fr_80px_60px] items-center gap-3"
            >
              <div className="truncate text-[12.5px]">{sp.name}</div>
              <Bar pct={sp.pct} color={sp.color} height={6} />
              <div className="mono text-right text-[11px] text-ink-2">
                {sp.cost}
              </div>
              <div className="mono text-[10.5px] text-muted-2">{sp.cap}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
