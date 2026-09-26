'use client';

import type { ApprovalRow, Metrics, TaskRow } from '@/lib/portal-data';
import {
  ACCENT,
  FILTERS,
  GATE,
  isGate,
  TASK_STATUS_COLOUR,
  matchesFilter,
  percent,
  statusLabel,
  swatch,
  type FilterKey,
} from '@/lib/portal-ui';
import { Ago, Bar, ColLabel, Empty, Pill, TableCard } from '../ui';

const GATE_ASK: Record<ApprovalRow['gate'], string> = {
  plan: 'Approve the plan before any code is written',
  merge: 'Approve the pull request before it merges',
  production: 'Approve the release before it reaches production',
  information: 'The agent needs an answer before it can continue',
};

/**
 * Open gates pinned above the table. Orange is reserved for "a person
 * decides", so this is the only orange block on the screen and it disappears
 * when nothing is waiting.
 */
function WaitingForYou({
  approvals,
  onOpen,
}: {
  approvals: ApprovalRow[];
  onOpen: (taskId: string) => void;
}) {
  if (approvals.length === 0) return null;
  const shown = approvals.slice(0, 3);
  return (
    <section className="flex flex-col gap-3" aria-label="Waiting for you">
      <div className="flex items-center gap-2.5">
        <span className="size-2 rounded-full bg-gate" />
        <h2 className="text-[15px] font-semibold">Waiting for you</h2>
        <span className="text-[13px] text-muted-2">
          {approvals.length} gate{approvals.length === 1 ? '' : 's'} open
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {shown.map((ap) => (
          <button
            key={ap.id}
            onClick={() => onOpen(ap.task_id)}
            className="lift flex cursor-pointer flex-col gap-2 rounded-[18px] border border-[#F0C9A8] bg-gate-tint/60 p-4 text-left hover:border-gate"
          >
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-semibold tracking-[0.06em] text-gate-ink uppercase">
                {ap.gate} gate
              </span>
              <span className="mono text-[12px] text-muted-2">
                {ap.reference}
              </span>
            </div>
            <div className="line-clamp-2 text-[15px] font-semibold tracking-[-0.01em] text-ink">
              {ap.title}
            </div>
            <div className="text-[13px] text-muted">{GATE_ASK[ap.gate]}</div>
            <div className="mt-1 flex items-center justify-between text-[12.5px]">
              <span className="text-muted-2">
                waiting <Ago iso={ap.requested_at} />
              </span>
              <span className="font-semibold text-gate-ink">Review →</span>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

const GRID =
  'grid min-w-[960px] grid-cols-[96px_minmax(220px,1fr)_200px_110px_150px_90px]';

function barColor(status: string) {
  if (status === 'failed' || status === 'rolled_back') return '#B42318';
  if (status === 'completed') return '#1F7A4D';
  if (isGate(status)) return GATE;
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
    <div className="card flex flex-col gap-2 px-4 py-4">
      <div className="label">{label}</div>
      <div className="display text-[30px] leading-none font-bold tracking-[-0.03em]">
        {value}
      </div>
      <div className="text-[12.5px]" style={{ color: noteColor ?? '#5F616A' }}>
        {note}
      </div>
    </div>
  );
}

export default function Tasks({
  tasks,
  approvals,
  metrics,
  filter,
  onFilter,
  onOpen,
}: {
  tasks: TaskRow[];
  approvals: ApprovalRow[];
  metrics: Metrics;
  filter: FilterKey;
  onFilter: (f: FilterKey) => void;
  onOpen: (taskId: string) => void;
}) {
  const visible = tasks.filter((t) => matchesFilter(t.status, filter));

  return (
    <div className="flex flex-col gap-6">
      <WaitingForYou approvals={approvals} onOpen={onOpen} />

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
              ? '#C2410C'
              : undefined
          }
        />
        <Metric
          label="COMPLETED · 7D"
          value={String(metrics.completed_7d)}
          note="merged or deployed"
          noteColor={metrics.completed_7d > 0 ? '#17603C' : undefined}
        />
        <Metric
          label="FAILED · 7D"
          value={String(metrics.failed_7d)}
          note="stopped with a reason on record"
          noteColor={metrics.failed_7d > 0 ? '#B42318' : undefined}
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
                  className="min-h-[34px] cursor-pointer rounded-full border px-3.5 py-1 text-[13.5px] font-medium"
                  style={{
                    borderColor: filter === f.key ? '#15161A' : '#DAD5C8',
                    background: filter === f.key ? '#15161A' : 'transparent',
                    color: filter === f.key ? '#FFFFFF' : '#5B5D66',
                  }}
                >
                  {f.label}
                </button>
              ))}
              <div className="flex-1" />
              <div className="mono text-muted-2" style={{ fontSize: 12 }}>
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
            <div className="px-3.5 py-8 text-[14px] text-muted">
              No task matches this filter.
            </div>
          ) : null}

          {visible.map((t) => (
            <div
              key={t.id}
              onClick={() => onOpen(t.id)}
              className={`${GRID} row-hover cursor-pointer items-center border-b border-line-faint px-3.5 py-[11px]`}
            >
              <div className="mono text-[12.5px] font-medium text-accent">
                {t.reference}
              </div>
              <div className="flex min-w-0 flex-col gap-[3px] pr-4">
                <div className="truncate text-[14.5px] font-medium tracking-[-0.005em]">
                  {t.title}
                </div>
                <div className="text-[12.5px] text-muted-2">
                  {t.project ?? 'no project'}
                  <span className="text-[#B9B4A8]"> · </span>
                  {t.priority}
                </div>
              </div>
              <div>
                <Pill
                  c={swatch(TASK_STATUS_COLOUR, t.status)}
                  style={{ maxWidth: 184, overflowWrap: 'anywhere' }}
                >
                  {statusLabel(t.status)}
                </Pill>
              </div>
              <div className="pr-5">
                <Bar
                  pct={percent(t.progress_percent)}
                  color={barColor(t.status)}
                />
              </div>
              <div className="mono truncate text-[12px] text-muted">
                {t.branch_name ?? '—'}
              </div>
              <div className="mono text-right text-[12px] text-muted-2">
                <Ago iso={t.updated_at} />
              </div>
            </div>
          ))}
        </TableCard>
      )}
    </div>
  );
}
