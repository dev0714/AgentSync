'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { TaskDetail } from '@/lib/portal-data';
import {
  RESULT_COLOUR,
  SEVERITY_COLOUR,
  TASK_STATUS_COLOUR,
  VERDICT_COLOUR,
  clock,
  compact,
  duration,
  eventColour,
  isGate,
  money,
  percent,
  statusLabel,
  swatch,
} from '@/lib/portal-ui';
import { TierBadge } from '../tiers';
import Attachments from './Attachments';
import { Bar, CodeBlock, ColLabel, Pill, SectionTitle, Tabs } from '../ui';

export type DetailTab = 'plan' | 'diff' | 'checks' | 'request' | 'events';

const TABS: { k: DetailTab; label: string }[] = [
  { k: 'plan', label: 'Plan' },
  { k: 'diff', label: 'Changes' },
  { k: 'checks', label: 'Validation' },
  { k: 'request', label: 'Request' },
  { k: 'events', label: 'Events' },
];

const ACTION_COLOUR: Record<string, string> = {
  CREATED: 'var(--color-ok-ink)',
  MODIFIED: 'var(--color-gate-ink)',
  DELETED: 'var(--color-danger)',
  RENAMED: 'var(--color-agent-ink)',
};

function Rail({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="label mb-3">{title}</div>
      {children}
    </div>
  );
}

/** What approving each gate lets happen next — said before anyone clicks. */
const GATE_BANNER: Record<string, { title: string; body: string }> = {
  awaiting_plan_approval: {
    title: 'The plan is waiting for your approval',
    body: 'No code has been written. Approving lets the Developer agent start on a branch; nothing touches the default branch.',
  },
  awaiting_merge_approval: {
    title: 'The pull request is waiting for your approval',
    body: 'Checks and the Review agent have finished. Approving merges the pull request; the agent is never allowed to merge its own work.',
  },
  awaiting_production_approval: {
    title: 'The release is waiting for your approval',
    body: 'The change is merged and staged. Approving deploys it to production; the rollback plan below is what runs if it fails.',
  },
  needs_information: {
    title: 'The agent needs an answer',
    body: 'Work is paused until someone answers the open questions on the plan.',
  },
};

/** A stage the task has actually recorded, never one inferred from the status. */
function nothing(text: string) {
  return (
    <div className="p-[18px] text-[14px] text-muted" style={{ lineHeight: 1.6 }}>
      {text}
    </div>
  );
}

export default function Detail({
  taskId,
  tab,
  onTab,
  onBack,
}: {
  taskId: string;
  tab: DetailTab;
  onTab: (t: DetailTab) => void;
  onBack: () => void;
}) {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    fetch(`/api/portal/tasks/${taskId}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 404 ? 'No such task.' : 'Could not load this task.');
        return r.json();
      })
      .then((d: TaskDetail) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [taskId, reload]);

  const back = (
    <button
      onClick={onBack}
      className="w-fit cursor-pointer text-[13.5px] font-medium text-agent-ink hover:underline"
    >
      ← All tasks
    </button>
  );

  if (error) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <div className="card p-8 text-[14px] text-danger">{error}</div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <div className="card p-8 text-[14px] text-muted">Loading…</div>
      </div>
    );
  }

  const { task, plan, files, commands, review, events, usage } = detail;
  const additions = files.reduce((n, f) => n + f.additions, 0);
  const deletions = files.reduce((n, f) => n + f.deletions, 0);
  const peak = Math.max(...files.map((f) => f.additions + f.deletions), 1);
  const buildOutput = commands.find((c) => c.sanitised_output)?.sanitised_output;

  const banner = isGate(task.status)
    ? (GATE_BANNER[task.status] ?? {
        title: 'This task is waiting for a person',
        body: 'Nothing moves past this gate until someone with approval rights decides.',
      })
    : null;
  // The last few recorded events, newest first — the rail's "where it is".
  const recent = events.slice(-6).reverse();

  const steps: string[] = Array.isArray(plan?.steps)
    ? (plan.steps as unknown[]).map((s) =>
        typeof s === 'string' ? s : JSON.stringify(s),
      )
    : [];

  return (
    <div className="flex flex-col gap-4">
      {back}

      <div className="flex flex-col items-start gap-4 xl:flex-row">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-2.5">
            <span className="mono text-xs font-medium text-accent">
              {task.external_reference ?? task.correlation_id.slice(0, 8)}
            </span>
            <Pill c={swatch(TASK_STATUS_COLOUR, task.status)}>
              {statusLabel(task.status)}
            </Pill>
            <TierBadge tier={task.tier} />
            <span className="mono text-[12px] text-muted-2">
              corr: {task.correlation_id}
            </span>
            {detail.project ? (
              <span className="mono text-[12px] text-muted-3">
                {detail.project.name}
              </span>
            ) : null}
          </div>
          <div
            className="display text-[24px] leading-tight font-semibold tracking-[-0.02em]"
            style={{ textWrap: 'pretty' }}
          >
            {task.title}
          </div>
        </div>
      </div>

      {banner ? (
        <GateBanner
          taskId={task.id}
          status={task.status}
          title={banner.title}
          body={banner.body}
          onDecided={() => setReload((n) => n + 1)}
        />
      ) : null}

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[1fr_328px]">
        <div className="card min-w-0 overflow-hidden">
          <div className="card-head">
            <Tabs tabs={TABS} active={tab} onSelect={onTab} />
          </div>

          {tab === 'plan' ? (
            !plan ? (
              nothing(
                'No plan has been written for this task yet. The Planner records one before any file is touched.',
              )
            ) : (
              <div className="p-[18px]">
                <SectionTitle
                  title="Implementation plan"
                  meta={`v${plan.version} · ${clock(plan.created_at)}`}
                  right={
                    plan.complexity ? (
                      <Pill c={['var(--color-ok-tint)', 'var(--color-ok-ink)']}>
                        COMPLEXITY: {plan.complexity.toUpperCase()}
                      </Pill>
                    ) : undefined
                  }
                />
                <div
                  className="mt-3.5 mb-[18px] text-[15px] text-ink-3"
                  style={{ lineHeight: 1.6, textWrap: 'pretty' }}
                >
                  {plan.summary}
                </div>

                <div className="grid grid-cols-1 gap-[18px] lg:grid-cols-2">
                  <div>
                    <div className="label mb-[9px]">Implementation steps</div>
                    <div className="flex flex-col gap-[7px]">
                      {steps.map((s, i) => (
                        <div key={i} className="flex items-baseline gap-[9px]">
                          <span className="mono text-[11.5px] text-accent">
                            {String(i + 1).padStart(2, '0')}
                          </span>
                          <span
                            className="text-[14px] text-ink-3"
                            style={{ lineHeight: 1.55 }}
                          >
                            {s}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-col gap-4">
                    {plan.assumptions?.length ? (
                      <div>
                        <div className="label mb-[9px]">Assumptions</div>
                        <div className="flex flex-col gap-1.5">
                          {plan.assumptions.map((a) => (
                            <div
                              key={a}
                              className="rounded-md border border-line bg-raised px-3 py-2 text-[13.5px] text-muted"
                              style={{ lineHeight: 1.5 }}
                            >
                              {a}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {plan.open_questions?.length ? (
                      <div>
                        <div className="label mb-[9px]">Open questions</div>
                        <div className="flex flex-col gap-1.5">
                          {plan.open_questions.map((q) => (
                            <div
                              key={q}
                              className="rounded-md border px-3 py-2 text-[13.5px] text-warn-2"
                              style={{
                                borderColor: 'var(--color-gate-line)',
                                background: 'var(--color-gate-tint)',
                                lineHeight: 1.5,
                              }}
                            >
                              {q}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {plan.rollback_plan ? (
                      <div>
                        <div className="label mb-[9px]">Rollback</div>
                        <div
                          className="text-[14px] text-muted"
                          style={{ lineHeight: 1.55 }}
                        >
                          {plan.rollback_plan}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            )
          ) : null}

          {tab === 'diff' ? (
            files.length === 0 ? (
              nothing('No file has been changed on this task.')
            ) : (
              <div className="p-[18px]">
                <SectionTitle
                  title="File changes"
                  right={
                    <div className="mono text-[11.5px] text-muted-2">
                      {files.length} files
                    </div>
                  }
                />
                <div className="mono mt-1 mb-3.5 text-[12.5px]">
                  <span className="text-ok">+{additions}</span>{' '}
                  <span className="text-danger">−{deletions}</span>
                </div>

                <div className="overflow-hidden rounded-lg border border-line">
                  {files.map((f) => (
                    <div
                      key={f.file_path}
                      className="flex flex-wrap items-center gap-3 border-b border-line-faint px-3.5 py-2.5 last:border-b-0"
                    >
                      <span
                        className="mono w-[70px] shrink-0 text-[11.5px]"
                        style={{ color: ACTION_COLOUR[f.action] ?? 'var(--color-muted-2)' }}
                      >
                        {f.action}
                      </span>
                      <span className="mono min-w-0 flex-1 truncate text-[13px] text-ink-2">
                        {f.file_path}
                      </span>
                      <span className="mono text-[12px] text-muted-2">
                        +{f.additions} / −{f.deletions}
                      </span>
                      <div className="flex w-[60px] items-center gap-px">
                        <span
                          className="h-[6px] rounded-[1px] bg-ok"
                          style={{ width: `${(f.additions / peak) * 60}px` }}
                        />
                        <span
                          className="h-[6px] rounded-[1px] bg-danger"
                          style={{ width: `${(f.deletions / peak) * 60}px` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {review ? (
                  <div className="mt-3.5 rounded-lg border border-line bg-raised p-3.5">
                    <div className="mb-2 flex items-center gap-2.5">
                      <div className="label">Reviewer’s verdict</div>
                      <Pill c={swatch(VERDICT_COLOUR, review.verdict)}>
                        {review.verdict}
                      </Pill>
                    </div>
                    <div
                      className="text-[14px] text-ink-3"
                      style={{ lineHeight: 1.6 }}
                    >
                      {review.summary}
                    </div>
                  </div>
                ) : null}

                {detail.security_findings.length > 0 ? (
                  <div className="mt-3.5 flex flex-col gap-1.5">
                    <div className="label">Security findings</div>
                    {detail.security_findings.map((sf, i) => (
                      <div
                        key={i}
                        className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-raised px-3 py-2"
                      >
                        <Pill c={swatch(SEVERITY_COLOUR, sf.severity)}>
                          {sf.severity}
                        </Pill>
                        <span className="mono text-[12.5px] text-ink-2">
                          {sf.file_path}
                          {sf.line_number ? `:${sf.line_number}` : ''}
                        </span>
                        <span className="text-[13.5px] text-muted">
                          {sf.description}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            )
          ) : null}

          {tab === 'checks' ? (
            commands.length === 0 ? (
              nothing(
                'No validation command has run. The Validator records every command, its exit code and its sanitised output.',
              )
            ) : (
              <div className="p-[18px]">
                <div className="mb-3.5 text-[14.5px] font-semibold">
                  Validation runs
                </div>
                <div className="overflow-hidden rounded-lg border border-line">
                  {commands.map((c, i) => (
                    <div
                      key={`${c.command}-${i}`}
                      className="flex flex-wrap items-center gap-3 border-b border-line-faint px-3.5 py-2.5 last:border-b-0"
                    >
                      <span className="mono w-[120px] shrink-0 text-[11.5px] text-muted-2">
                        {c.command_type}
                      </span>
                      <span className="mono min-w-0 flex-1 truncate text-[13px] text-ink-2">
                        {c.command}
                      </span>
                      <span className="mono text-[12px] text-muted-2">
                        exit {c.exit_code ?? '—'}
                      </span>
                      <span className="mono w-[56px] text-right text-[12px] text-muted">
                        {duration(c.duration_seconds)}
                      </span>
                      <Pill c={swatch(RESULT_COLOUR, c.result)}>{c.result}</Pill>
                    </div>
                  ))}
                </div>

                {buildOutput ? (
                  <div className="mt-3.5">
                    <div className="label mb-2">Output (secrets removed)</div>
                    <CodeBlock
                      lines={buildOutput
                        .split('\n')
                        .map((text) => ({ text, color: 'var(--color-muted-2)' }))}
                    />
                  </div>
                ) : null}
              </div>
            )
          ) : null}

          {tab === 'request' ? (
            <div className="grid grid-cols-1 gap-[18px] p-[18px] lg:grid-cols-2">
              <div>
                <div className="label mb-2">Original request</div>
                <div
                  className="mb-4 text-[15px] text-ink-3"
                  style={{ lineHeight: 1.6 }}
                >
                  {task.description ?? 'No description was submitted.'}
                </div>
                <div className="label mb-2">Acceptance criteria</div>
                {task.acceptance_criteria?.length ? (
                  <div className="flex flex-col gap-1.5">
                    {task.acceptance_criteria.map((c) => (
                      <div key={c} className="flex items-baseline gap-2.5">
                        <span className="text-[12.5px] text-muted-2">·</span>
                        <span
                          className="text-[14px] text-ink-3"
                          style={{ lineHeight: 1.55 }}
                        >
                          {c}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[14px] text-muted">None submitted.</div>
                )}
              </div>
              <div>
                <div className="label mb-2">Submission</div>
                <CodeBlock
                  lines={JSON.stringify(
                    {
                      source: detail.source,
                      request_type: task.request_type,
                      priority: task.priority,
                      external_reference: task.external_reference,
                      requested_by: task.requested_by,
                      created_at: task.created_at,
                    },
                    null,
                    2,
                  )
                    .split('\n')
                    .map((text) => ({ text, color: 'var(--color-muted-2)' }))}
                />
              </div>
            </div>
          ) : null}

          {tab === 'events' ? (
            <div className="p-[18px]">
              <SectionTitle
                title="Event log"
                right={<Pill c={['var(--color-line-faint)', 'var(--color-muted-2)']}>Entries can’t be changed</Pill>}
              />
              <div className="mt-3.5 flex flex-col">
                {events.map((e, i) => (
                  <div key={e.id} className="flex gap-3">
                    <div className="mono w-[62px] shrink-0 pt-px text-[12px] text-muted-2">
                      {clock(e.created_at)}
                    </div>
                    <div className="flex flex-col items-center">
                      <div
                        className="mt-1 size-[7px] shrink-0 rounded-full"
                        style={{ background: eventColour(e.event_type) }}
                      />
                      {i < events.length - 1 ? (
                        <div className="w-px flex-1 bg-line" />
                      ) : null}
                    </div>
                    <div className="pb-3.5">
                      <div className="mono text-[12px] text-ink-2">
                        {e.event_type}
                      </div>
                      <div className="text-[13.5px] text-muted">
                        {e.message}
                        {e.actor ? (
                          <span className="text-muted-3"> · {e.actor}</span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {/* ---- right rail ---- */}
        <div className="flex flex-col gap-4">
          <Attachments taskId={task.id} />

          <Rail title="Details">
            {recent.length === 0 ? (
              <div className="text-[13.5px] text-muted">
                No event has been recorded yet.
              </div>
            ) : (
              <ol className="flex flex-col">
                {recent.map((e, i) => (
                  <li key={e.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span
                        className={`mt-1 size-2.5 shrink-0 rounded-full ${i === 0 ? 'ring-4 ring-agent-tint' : ''}`}
                        style={{ background: eventColour(e.event_type) }}
                      />
                      {i < recent.length - 1 ? (
                        <span className="w-px flex-1 bg-line" />
                      ) : null}
                    </div>
                    <div className="min-w-0 pb-3">
                      <div className="text-[13.5px] font-medium text-ink-2">
                        {statusLabel(e.event_type)}
                      </div>
                      <div className="mono text-[11.5px] text-muted-3">
                        {clock(e.created_at)}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Rail>

          <Rail title="Progress">
            <div className="mb-1.5 flex justify-between">
              <span className="text-[13px] text-muted">
                {statusLabel(task.status)}
              </span>
              <span className="mono text-[12.5px] text-ink-2">
                {percent(task.progress_percent)}
              </span>
            </div>
            <Bar pct={percent(task.progress_percent)} color="var(--color-accent)" />
            {task.error_code ? (
              <div className="mono mt-3 text-[12.5px] text-danger">
                {task.error_code}
              </div>
            ) : null}
          </Rail>

          <Rail title="Artefacts">
            <div className="flex flex-col gap-2.5">
              <div>
                <ColLabel>Branch</ColLabel>
                <div className="mono break-all text-[12.5px] text-ink-2">
                  {task.branch_name ?? '—'}
                </div>
              </div>
              <div>
                <ColLabel>Commit</ColLabel>
                <div className="mono break-all text-[12.5px] text-ink-2">
                  {task.commit_sha ?? '—'}
                </div>
              </div>
              <div>
                <ColLabel>Pull request</ColLabel>
                <div className="mono break-all text-[12.5px] text-accent">
                  {task.pull_request_url ?? '—'}
                </div>
              </div>
            </div>
          </Rail>

          <Rail title="AI usage">
            <div className="flex flex-col gap-1.5">
              {[
                ['Calls', String(usage.calls)],
                ['Input tokens', compact(usage.input_tokens)],
                ['Output tokens', compact(usage.output_tokens)],
                ['Cost', money(usage.cost)],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-baseline justify-between gap-3"
                >
                  <span className="text-[13px] text-muted">{label}</span>
                  <span className="mono text-[12.5px] text-ink-2">{value}</span>
                </div>
              ))}
            </div>
          </Rail>

          {detail.approvals.length > 0 ? (
            <Rail title="Approvals">
              <div className="flex flex-col gap-2">
                {detail.approvals.map((a, i) => (
                  <div key={i} className="flex items-baseline justify-between gap-3">
                    <span className="text-[13px] text-muted">{a.gate}</span>
                    <span className="mono text-[12.5px] text-ink-2">
                      {a.decision}
                      {a.decided_by_email ? ` · ${a.decided_by_email}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </Rail>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const GATE_FOR: Record<string, 'plan' | 'merge'> = {
  awaiting_plan_approval: 'plan',
  awaiting_merge_approval: 'merge',
};

const DECISION_ERROR: Record<string, string> = {
  NOT_AUTHORISED: 'Your role cannot approve for this tenant. Ask a tenant admin or approver.',
  NOT_AT_GATE: 'This task has already moved on — refresh to see where it is.',
  COMMENT_REQUIRED: 'Say what should change before requesting changes.',
};

/**
 * The orange block a person acts on. Approve, ask for changes (with a note the
 * agent will read) or reject. The server re-checks the role and the gate, so
 * these buttons are a convenience, not the control.
 */
function GateBanner({
  taskId,
  status,
  title,
  body,
  onDecided,
}: {
  taskId: string;
  status: string;
  title: string;
  body: string;
  onDecided: () => void;
}) {
  const router = useRouter();
  const gate = GATE_FOR[status];
  const [comment, setComment] = useState('');
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function decide(decision: 'approved' | 'changes_requested' | 'rejected') {
    if (decision === 'changes_requested' && !comment.trim()) {
      setAsking(true);
      setProblem(DECISION_ERROR.COMMENT_REQUIRED);
      return;
    }
    if (decision === 'rejected' && !window.confirm('Reject and cancel this task?')) return;
    setBusy(decision);
    setProblem(null);
    try {
      const res = await fetch(`/api/portal/tasks/${taskId}/decision`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gate, decision, comment: comment.trim() || undefined }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setProblem(DECISION_ERROR[data.error ?? ''] ?? `Could not record the decision (${data.error ?? res.status}).`);
        return;
      }
      setComment('');
      setAsking(false);
      onDecided();
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      role="status"
      className="flex flex-col gap-4 rounded-[10px] border border-[var(--color-gate-line)] bg-gate-tint px-5 py-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <span className="pulse-ring relative flex size-9 shrink-0 items-center justify-center rounded-full bg-gate text-on-gate">
          <span className="size-2.5 rounded-full bg-on-gate" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[15.5px] font-semibold text-gate-ink">{title}</div>
          <div className="text-[14px] text-ink-3" style={{ lineHeight: 1.55 }}>
            {body}
          </div>
        </div>
        {gate ? (
          <div className="flex shrink-0 flex-wrap gap-2">
            <button className="btn-gate" disabled={!!busy} onClick={() => decide('approved')}>
              {busy === 'approved' ? 'Approving…' : gate === 'plan' ? 'Approve plan' : 'Approve & merge'}
            </button>
            <button className="btn" disabled={!!busy} onClick={() => (asking ? decide('changes_requested') : setAsking(true))}>
              {busy === 'changes_requested' ? 'Sending…' : asking ? 'Send changes' : 'Request changes'}
            </button>
            <button className="btn btn-danger" disabled={!!busy} onClick={() => decide('rejected')}>
              Reject
            </button>
          </div>
        ) : null}
      </div>
      {asking ? (
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-2">What should change?</span>
          <textarea
            className="field-input min-h-[88px] py-2"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="The agent reads this before it tries again."
          />
        </label>
      ) : null}
      {problem ? <div className="text-[13.5px] text-danger-ink">{problem}</div> : null}
    </div>
  );
}
