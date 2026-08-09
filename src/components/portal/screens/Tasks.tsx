'use client';

import {
  ACCENT,
  FILTERS,
  METRICS,
  PILL,
  TASKS,
  matchesFilter,
  type FilterKey,
  type Task,
} from '@/data/portal';
import { Bar, ColLabel, Pill, TableCard } from '../ui';

const GRID =
  'grid min-w-[960px] grid-cols-[96px_minmax(220px,1fr)_200px_110px_150px_90px]';

function barColor(task: Task) {
  if (task.status === 'failed') return '#F08A80';
  if (task.status === 'completed') return '#4ADE80';
  return ACCENT;
}

export default function Tasks({
  filter,
  onFilter,
  onOpen,
}: {
  filter: FilterKey;
  onFilter: (f: FilterKey) => void;
  onOpen: () => void;
}) {
  const visible = TASKS.filter((t) => matchesFilter(t, filter));

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {METRICS.map((m) => (
          <div key={m.label} className="card flex flex-col gap-[7px] px-[15px] py-3.5">
            <div className="label">{m.label}</div>
            <div className="text-2xl leading-none font-semibold tracking-[-0.02em]">
              {m.value}
            </div>
            <div className="text-[11px]" style={{ color: m.deltaColor }}>
              {m.delta}
            </div>
          </div>
        ))}
      </div>

      <TableCard
        head={
          <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3.5 py-[11px]">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => onFilter(f.key)}
                className="cursor-pointer rounded-[20px] border px-[11px] py-1 text-[11.5px] font-medium"
                style={{
                  borderColor: filter === f.key ? '#0E0E10' : '#242428',
                  background: filter === f.key ? '#0E0E10' : 'transparent',
                  color: filter === f.key ? '#F2F2F4' : '#9A9AA3',
                }}
              >
                {f.label}
              </button>
            ))}
            <div className="flex-1" />
            <div className="mono text-muted-2" style={{ fontSize: 10.5 }}>
              {visible.length} OF {TASKS.length} TASKS
            </div>
          </div>
        }
      >
        <div
          className={`${GRID} border-b border-line bg-raised px-3.5 py-[9px]`}
        >
          <ColLabel>REF</ColLabel>
          <ColLabel>TITLE / PROJECT</ColLabel>
          <ColLabel>STATUS</ColLabel>
          <ColLabel>PROGRESS</ColLabel>
          <ColLabel>BRANCH</ColLabel>
          <ColLabel right>UPDATED</ColLabel>
        </div>

        {visible.map((t) => (
          <div
            key={t.ref}
            onClick={onOpen}
            className={`${GRID} row-hover cursor-pointer items-center border-b border-line-faint px-3.5 py-[11px]`}
          >
            <div className="mono text-[11px] font-medium text-accent">
              {t.ref}
            </div>
            <div className="flex min-w-0 flex-col gap-[3px] pr-4">
              <div className="truncate text-[13px] font-medium tracking-[-0.005em]">
                {t.title}
              </div>
              <div className="text-[11px] text-muted-2">
                {t.project}
                <span className="text-[#3A3A40]"> · </span>
                {t.priority}
              </div>
            </div>
            <div>
              <Pill
                c={PILL[t.status] ?? PILL.queued}
                style={{ maxWidth: 184, overflowWrap: 'anywhere' }}
              >
                {t.status}
              </Pill>
            </div>
            <div className="pr-5">
              <Bar pct={`${t.pct}%`} color={barColor(t)} />
            </div>
            <div className="mono truncate text-[10.5px] text-muted">
              {t.branch}
            </div>
            <div className="mono text-right text-[10.5px] text-muted-2">
              {t.updated}
            </div>
          </div>
        ))}
      </TableCard>
    </div>
  );
}
