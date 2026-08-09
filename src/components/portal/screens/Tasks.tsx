'use client';

import type { Metrics, TaskRow } from '@/lib/portal-data';
import {
  ACCENT,
  FILTERS,
  TASK_STATUS_COLOUR,
  matchesFilter,
  percent,
  swatch,
  type FilterKey,
} from '@/lib/portal-ui';
import { Ago, Bar, ColLabel, Empty, Pill, TableCard } from '../ui';

const GRID =
  'grid min-w-[960px] grid-cols-[96px_minmax(220px,1fr)_200px_110px_150px_90px]';

function barColor(status: string) {
  if (status === 'failed' || status === 'rolled_back') return '#F08A80';
  if (status === 'completed') return '#4ADE80';
  return ACCENT;
}

function Metric({
  label,
  value,
  note,
  noteColor,
}: {
  label: string;
  value: string;
  note: string;
  noteColor?: string;
}) {
  return (
    <div className="card flex flex-col gap-[7px] px-[15px] py-3.5">
      <div className="label">{label}</div>
      <div className="text-2xl leading-none font-semibold tracking-[-0.02em]">
        {value}
      </div>
      <div className="text-[11px]" style={{ color: noteColor ?? '#71717B' }}>
        {note}
      </div>
    </div>
  );
}

export default function Tasks({
  tasks,
  metrics,
  filter,
  onFilter,
  onOpen,
}: {
  tasks: TaskRow[];
  metrics: Metrics;
  filter: FilterKey;
  onFilter: (f: FilterKey) => void;
  onOpen: (taskId: string) => void;
}) {
  const visible = tasks.filter((t) => matchesFilter(t.status, filter));

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Metric
          label="IN FLIGHT"
          value={String(metrics.in_flight)}
          note={`${metrics.total} tasks all time`}
        />
        <Metric
          label="AWAITING A HUMAN"
          value={String(metrics.awaiting_approval + metrics.needs_information)}
          note={
            metrics.needs_information > 0
              ? `${metrics.needs_information} need information`
              : 'approval gates open'
          }
          noteColor={
            metrics.awaiting_approval + metrics.needs_information > 0
              ? '#F5A623'
              : undefined
          }
        />
        <Metric
          label="COMPLETED · 7D"
          value={String(metrics.completed_7d)}
          note="merged or deployed"
          noteColor={metrics.completed_7d > 0 ? '#6FD69C' : undefined}
        />
        <Metric
          label="FAILED · 7D"
          value={String(metrics.failed_7d)}
          note="stopped with a reason on record"
          noteColor={metrics.failed_7d > 0 ? '#F08A80' : undefined}
        />
        <Metric
          label="MEDIAN CYCLE"
          value={
            metrics.median_minutes === null
              ? '—'
              : `${metrics.median_minutes}m`
          }
          note="submission to completion"
        />
      </div>

      {tasks.length === 0 ? (
        <Empty
          title="No tasks yet"
          detail="Tasks appear here as soon as a source system submits one. Issue a key on the Source systems screen, then POST to /api/v1/agent/tasks with it."
          table="agentsync.agent_tasks"
        />
      ) : (
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
                {visible.length} OF {tasks.length} TASKS
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

          {visible.length === 0 ? (
            <div className="px-3.5 py-8 text-[12.5px] text-muted">
              No task matches this filter.
            </div>
          ) : null}

          {visible.map((t) => (
            <div
              key={t.id}
              onClick={() => onOpen(t.id)}
              className={`${GRID} row-hover cursor-pointer items-center border-b border-line-faint px-3.5 py-[11px]`}
            >
              <div className="mono text-[11px] font-medium text-accent">
                {t.reference}
              </div>
              <div className="flex min-w-0 flex-col gap-[3px] pr-4">
                <div className="truncate text-[13px] font-medium tracking-[-0.005em]">
                  {t.title}
                </div>
                <div className="text-[11px] text-muted-2">
                  {t.project ?? 'no project'}
                  <span className="text-[#3A3A40]"> · </span>
                  {t.priority}
                </div>
              </div>
              <div>
                <Pill
                  c={swatch(TASK_STATUS_COLOUR, t.status)}
                  style={{ maxWidth: 184, overflowWrap: 'anywhere' }}
                >
                  {t.status}
                </Pill>
              </div>
              <div className="pr-5">
                <Bar
                  pct={percent(t.progress_percent)}
                  color={barColor(t.status)}
                />
              </div>
              <div className="mono truncate text-[10.5px] text-muted">
                {t.branch_name ?? '—'}
              </div>
              <div className="mono text-right text-[10.5px] text-muted-2">
                <Ago iso={t.updated_at} />
              </div>
            </div>
          ))}
        </TableCard>
      )}
    </div>
  );
}
