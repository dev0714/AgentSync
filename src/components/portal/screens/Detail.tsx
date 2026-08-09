'use client';

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
  money,
  percent,
  swatch,
} from '@/lib/portal-ui';
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
  CREATED: '#6FD69C',
  MODIFIED: '#F0B45E',
  DELETED: '#F08A80',
  RENAMED: '#7FB6E0',
};

function Rail({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="label mb-3">{title}</div>
      {children}
    </div>
  );
}

/** A stage the task has actually recorded, never one inferred from the status. */
function nothing(text: string) {
  return (
    <div className="p-[18px] text-[12.5px] text-muted" style={{ lineHeight: 1.6 }}>
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
  }, [taskId]);

  const back = (
    <button
      onClick={onBack}
      className="mono w-fit cursor-pointer text-[11px] text-accent"
    >
      ← ALL TASKS
    </button>
  );

  if (error) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <div className="card p-8 text-[12.5px] text-danger">{error}</div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <div className="card p-8 text-[12.5px] text-muted">Loading…</div>
      </div>
    );
  }

  const { task, plan, files, commands, review, events, usage } = detail;
  const additions = files.reduce((n, f) => n + f.additions, 0);
  const deletions = files.reduce((n, f) => n + f.deletions, 0);
  const peak = Math.max(...files.map((f) => f.additions + f.deletions), 1);
  const buildOutput = commands.find((c) => c.sanitised_output)?.sanitised_output;

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
              {task.status.toUpperCase()}
            </Pill>
            <span className="mono text-[10.5px] text-muted-2">
              corr: {task.correlation_id}
            </span>
            {detail.project ? (
              <span className="mono text-[10.5px] text-muted-3">
                {detail.project.name}
              </span>
            ) : null}
          </div>
          <div
            className="text-[22px] font-semibold tracking-[-0.02em]"
            style={{ textWrap: 'pretty' }}
          >
            {task.title}
          </div>
        </div>
      </div>

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
                      <Pill c={['#122E1E', '#6FD69C']}>
                        COMPLEXITY: {plan.complexity.toUpperCase()}
                      </Pill>
                    ) : undefined
                  }
                />
                <div
                  className="mt-3.5 mb-[18px] text-[13.5px] text-ink-3"
                  style={{ lineHeight: 1.6, textWrap: 'pretty' }}
                >
                  {plan.summary}
                </div>

                <div className="grid grid-cols-1 gap-[18px] lg:grid-cols-2">
                  <div>
                    <div className="label mb-[9px]">IMPLEMENTATION STEPS</div>
                    <div className="flex flex-col gap-[7px]">
                      {steps.map((s, i) => (
                        <div key={i} className="flex items-baseline gap-[9px]">
                          <span className="mono text-[10px] text-accent">
                            {String(i + 1).padStart(2, '0')}
                          </span>
                          <span
                            className="text-[12.5px] text-ink-3"
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
                        <div className="label mb-[9px]">ASSUMPTIONS</div>
                        <div className="flex flex-col gap-1.5">
                          {plan.assumptions.map((a) => (
                            <div
                              key={a}
                              className="rounded-md border border-line bg-raised px-3 py-2 text-[12px] text-muted"
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
                        <div className="label mb-[9px]">OPEN QUESTIONS</div>
                        <div className="flex flex-col gap-1.5">
                          {plan.open_questions.map((q) => (
                            <div
                              key={q}
                              className="rounded-md border px-3 py-2 text-[12px] text-warn-2"
                              style={{
                                borderColor: '#4A3616',
                                background: '#1A1408',
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
                        <div className="label mb-[9px]">ROLLBACK</div>
                        <div
                          className="text-[12.5px] text-muted"
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
                    <div className="mono text-[10px] text-muted-2">
                      {files.length} files
                    </div>
                  }
                />
                <div className="mono mt-1 mb-3.5 text-[11px]">
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
                        className="mono w-[70px] shrink-0 text-[9.5px]"
                        style={{ color: ACTION_COLOUR[f.action] ?? '#9A9AA3' }}
                      >
                        {f.action}
                      </span>
                      <span className="mono min-w-0 flex-1 truncate text-[11.5px] text-ink-2">
                        {f.file_path}
                      </span>
                      <span className="mono text-[10.5px] text-muted-2">
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
                      <div className="label">REVIEW AGENT VERDICT</div>
                      <Pill c={swatch(VERDICT_COLOUR, review.verdict)}>
                        {review.verdict}
                      </Pill>
                    </div>
                    <div
                      className="text-[12.5px] text-ink-3"
                      style={{ lineHeight: 1.6 }}
                    >
                      {review.summary}
                    </div>
                  </div>
                ) : null}

                {detail.security_findings.length > 0 ? (
                  <div className="mt-3.5 flex flex-col gap-1.5">
                    <div className="label">SECURITY FINDINGS</div>
                    {detail.security_findings.map((sf, i) => (
                      <div
                        key={i}
                        className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-raised px-3 py-2"
                      >
                        <Pill c={swatch(SEVERITY_COLOUR, sf.severity)}>
                          {sf.severity}
                        </Pill>
                        <span className="mono text-[11px] text-ink-2">
                          {sf.file_path}
                          {sf.line_number ? `:${sf.line_number}` : ''}
                        </span>
                        <span className="text-[12px] text-muted">
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
                <div className="mb-3.5 text-[13px] font-semibold">
                  Validation runs
                </div>
                <div className="overflow-hidden rounded-lg border border-line">
                  {commands.map((c, i) => (
                    <div
                      key={`${c.command}-${i}`}
                      className="flex flex-wrap items-center gap-3 border-b border-line-faint px-3.5 py-2.5 last:border-b-0"
                    >
                      <span className="mono w-[120px] shrink-0 text-[9.5px] text-muted-2">
                        {c.command_type}
                      </span>
                      <span className="mono min-w-0 flex-1 truncate text-[11.5px] text-ink-2">
                        {c.command}
                      </span>
                      <span className="mono text-[10.5px] text-muted-2">
                        exit {c.exit_code ?? '—'}
                      </span>
                      <span className="mono w-[56px] text-right text-[10.5px] text-muted">
                        {duration(c.duration_seconds)}
                      </span>
                      <Pill c={swatch(RESULT_COLOUR, c.result)}>{c.result}</Pill>
                    </div>
                  ))}
                </div>

                {buildOutput ? (
                  <div className="mt-3.5">
                    <div className="label mb-2">SANITISED OUTPUT</div>
                    <CodeBlock
                      lines={buildOutput
                        .split('\n')
                        .map((text) => ({ text, color: '#9A9AA3' }))}
                    />
                  </div>
                ) : null}
              </div>
            )
          ) : null}

          {tab === 'request' ? (
            <div className="grid grid-cols-1 gap-[18px] p-[18px] lg:grid-cols-2">
              <div>
                <div className="label mb-2">ORIGINAL REQUEST</div>
                <div
                  className="mb-4 text-[13.5px] text-ink-3"
                  style={{ lineHeight: 1.6 }}
                >
                  {task.description ?? 'No description was submitted.'}
                </div>
                <div className="label mb-2">ACCEPTANCE CRITERIA</div>
                {task.acceptance_criteria?.length ? (
                  <div className="flex flex-col gap-1.5">
                    {task.acceptance_criteria.map((c) => (
                      <div key={c} className="flex items-baseline gap-2.5">
                        <span className="text-[11px] text-muted-2">·</span>
                        <span
                          className="text-[12.5px] text-ink-3"
                          style={{ lineHeight: 1.55 }}
                        >
                          {c}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[12.5px] text-muted">None submitted.</div>
                )}
              </div>
              <div>
                <div className="label mb-2">SUBMISSION</div>
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
                    .map((text) => ({ text, color: '#9A9AA3' }))}
                />
              </div>
            </div>
          ) : null}

          {tab === 'events' ? (
            <div className="p-[18px]">
              <SectionTitle
                title="Event log"
                right={<Pill c={['#212125', '#9A9AA3']}>APPEND-ONLY</Pill>}
              />
              <div className="mt-3.5 flex flex-col">
                {events.map((e, i) => (
                  <div key={e.id} className="flex gap-3">
                    <div className="mono w-[62px] shrink-0 pt-px text-[10.5px] text-muted-2">
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
                      <div className="mono text-[10.5px] text-ink-2">
                        {e.event_type}
                      </div>
                      <div className="text-[12px] text-muted">
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
          <Rail title="PROGRESS">
            <div className="mb-1.5 flex justify-between">
              <span className="text-[11.5px] text-muted">
                {task.status.replace(/_/g, ' ')}
              </span>
              <span className="mono text-[11px] text-ink-2">
                {percent(task.progress_percent)}
              </span>
            </div>
            <Bar pct={percent(task.progress_percent)} color="#7C9CF5" />
            {task.error_code ? (
              <div className="mono mt-3 text-[11px] text-danger">
                {task.error_code}
              </div>
            ) : null}
          </Rail>

          <Rail title="ARTEFACTS">
            <div className="flex flex-col gap-2.5">
              <div>
                <ColLabel>BRANCH</ColLabel>
                <div className="mono break-all text-[11px] text-ink-2">
                  {task.branch_name ?? '—'}
                </div>
              </div>
              <div>
                <ColLabel>COMMIT</ColLabel>
                <div className="mono break-all text-[11px] text-ink-2">
                  {task.commit_sha ?? '—'}
                </div>
              </div>
              <div>
                <ColLabel>PULL REQUEST</ColLabel>
                <div className="mono break-all text-[11px] text-accent">
                  {task.pull_request_url ?? '—'}
                </div>
              </div>
            </div>
          </Rail>

          <Rail title="AI USAGE">
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
                  <span className="text-[11.5px] text-muted">{label}</span>
                  <span className="mono text-[11px] text-ink-2">{value}</span>
                </div>
              ))}
            </div>
          </Rail>

          {detail.approvals.length > 0 ? (
            <Rail title="APPROVALS">
              <div className="flex flex-col gap-2">
                {detail.approvals.map((a, i) => (
                  <div key={i} className="flex items-baseline justify-between gap-3">
                    <span className="text-[11.5px] text-muted">{a.gate}</span>
                    <span className="mono text-[11px] text-ink-2">
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
