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
const GATE_NAME: Record<ApprovalRow['gate'], string> = {
  plan: 'Plan approval',
  merge: 'Merge approval',
  production: 'Release approval',
  information: 'Question',
};

const GATE_CTA: Record<ApprovalRow['gate'], string> = {
  plan: 'Review plan',
  merge: 'Review pull request',
  production: 'Review release',
  information: 'Answer',
};

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
    <section className="flex flex-col gap-3" aria-labelledby="decide-h">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h2 id="decide-h" className="m-0 text-[16px] font-semibold">Needs your decision</h2>
        <span className="text-[13px] text-muted-3">
          {approvals.length} task{approvals.length === 1 ? ' is' : 's are'} paused until someone approves or answers
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {shown.map((ap) => (
          <button
            key={ap.id}
            onClick={() => onOpen(ap.task_id)}
            className="card flex cursor-pointer flex-col gap-2.5 border-[var(--color-gate-line)] p-4 text-left hover:border-gate"
          >
            <div className="flex items-center gap-2">
              <span className="inline-flex h-[22px] items-center gap-1.5 rounded-[5px] bg-gate-tint px-2 text-[12px] font-semibold text-gate-ink">
                <span className="size-1.5 rounded-full bg-gate" />
                {GATE_NAME[ap.gate]}
              </span>
              <span className="mono text-[12px] text-muted-3">{ap.reference}</span>
              <span className="flex-1" />
              <span className="text-[12px] text-muted-3">
                waiting <Ago iso={ap.requested_at} />
              </span>
            </div>
            <div className="line-clamp-2 text-[14.5px] leading-snug font-semibold text-ink">{ap.title}</div>
            <div className="text-[13px] text-muted-3">{GATE_ASK[ap.gate]}</div>
            <span className="mt-0.5 inline-flex h-[30px] items-center gap-1.5 self-start rounded-md border border-line-strong bg-card px-3 text-[13px] font-medium text-ink">
              {GATE_CTA[ap.gate]} →
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

const GRID =
  'grid min-w-[960px] grid-cols-[96px_minmax(220px,1fr)_200px_110px_150px_90px]';

function barColor(status: string) {
  if (status === 'failed' || status === 'rolled_back') return 'var(--color-danger)';
  if (status === 'completed') return 'var(--color-ok)';
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
    <div className="flex flex-col gap-1 border-line-soft px-[18px] py-3.5 [&:not(:first-child)]:border-l">
      <div className="text-[12.5px] font-medium text-muted-3">{label}</div>
      <div className="text-[24px] leading-tight font-semibold tracking-[-0.02em] tabular-nums">{value}</div>
      <div className="text-[12.5px]" style={{ color: noteColor ?? 'var(--color-muted-3)' }}>
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

      <section aria-label="At a glance" className="card grid grid-cols-2 lg:grid-cols-5">
        <Metric
          label="In progress"
          value={String(metrics.in_flight)}
          note={`${metrics.total} tasks all time`}
        />
        <Metric
          label="Needs a decision"
          value={String(metrics.awaiting_approval + metrics.needs_information)}
          note={
            metrics.needs_information > 0
              ? `${metrics.needs_information} need information`
              : 'waiting for a person'
          }
          noteColor={
            metrics.awaiting_approval + metrics.needs_information > 0
              ? 'var(--color-gate-ink)'
              : undefined
          }
        />
        <Metric
          label="Completed this week"
          value={String(metrics.completed_7d)}
          note="merged or deployed"
          noteColor={metrics.completed_7d > 0 ? 'var(--color-ok-ink)' : undefined}
        />
        <Metric
          label="Failed this week"
          value={String(metrics.failed_7d)}
          note="stopped with a reason on record"
          noteColor={metrics.failed_7d > 0 ? 'var(--color-danger-ink)' : undefined}
        />
        <Metric
          label="Median time to done"
          value={
            metrics.median_minutes === null
              ? '—'
              : `${metrics.median_minutes}m`
          }
          note="request to completion"
        />
      </section>

      {tasks.length === 0 ? (
        <Empty
          title="No tasks yet"
          detail="Tasks appear here as soon as a source system submits one. Issue a key on the Source systems screen, then POST to /api/v1/agent/tasks with it."
          table="agentsync.agent_tasks"
        />
      ) : (
        <TableCard
          head={
            <div className="flex flex-wrap items-center gap-3 border-b border-line-soft px-4 py-3">
              <h2 className="m-0 text-[15px] font-semibold">All tasks</h2>
              <div role="tablist" aria-label="Filter tasks" className="flex flex-wrap gap-0.5 rounded-lg border border-line-soft bg-raised p-[3px]">
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    role="tab"
                    aria-selected={filter === f.key}
                    onClick={() => onFilter(f.key)}
                    className={`h-7 cursor-pointer rounded-[5px] px-2.5 text-[12.5px] font-medium ${
                      filter === f.key ? 'dark-ring bg-card text-ink shadow-[0_1px_2px_rgba(17,19,24,0.12)]' : 'text-ink-3 hover:text-ink'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <div className="flex-1" />
              <div className="text-[12.5px] text-muted-3">
                {visible.length} of {tasks.length} tasks
              </div>
            </div>
          }
        >
          <div
            className={`${GRID} border-b border-line-soft bg-raised px-4 py-[9px]`}
          >
            <ColLabel>Reference</ColLabel>
            <ColLabel>Task</ColLabel>
            <ColLabel>Status</ColLabel>
            <ColLabel>Progress</ColLabel>
            <ColLabel>Branch</ColLabel>
            <ColLabel right>Updated</ColLabel>
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
              className={`${GRID} row-hover cursor-pointer items-center border-b border-line-faint px-4 py-[11px]`}
            >
              <div className="mono text-[12.5px] font-medium text-ink-3">
                {t.reference}
              </div>
              <div className="flex min-w-0 flex-col gap-[3px] pr-4">
                <div className="truncate text-[14.5px] font-medium tracking-[-0.005em]">
                  {t.title}
                </div>
                <div className="text-[12.5px] text-muted-2">
                  {t.project ?? 'no project'}
                  <span className="text-[var(--color-line-strong)]"> · </span>
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
