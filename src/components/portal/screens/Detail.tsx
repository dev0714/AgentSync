'use client';

import {
  ARTEFACTS,
  ASSUMPTIONS,
  COMMANDS,
  CRITERIA,
  DETAIL,
  EVENTS,
  FILES,
  GUARDRAILS_HELD,
  LOG_LINES,
  PAYLOAD_LINES,
  PLAN_STEPS,
  STAGES,
  USAGE_ROWS,
  type DetailTab,
} from '@/data/portal';
import { Bar, CodeBlock, ColLabel, Pill, SectionTitle, Tabs } from '../ui';

const TABS: { k: DetailTab; label: string }[] = [
  { k: 'plan', label: 'Plan' },
  { k: 'diff', label: 'Changes' },
  { k: 'checks', label: 'Validation' },
  { k: 'request', label: 'Request' },
  { k: 'events', label: 'Events' },
];

function Rail({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-4">
      <div className="label mb-3">{title}</div>
      {children}
    </div>
  );
}

export default function Detail({
  tab,
  onTab,
  onBack,
}: {
  tab: DetailTab;
  onTab: (t: DetailTab) => void;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <button
        onClick={onBack}
        className="mono w-fit cursor-pointer text-[11px] text-accent"
      >
        ← ALL TASKS
      </button>

      <div className="flex flex-col items-start gap-4 xl:flex-row">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-2.5">
            <span className="mono text-xs font-medium text-accent">
              {DETAIL.ref}
            </span>
            <Pill c={['#33240F', '#F0B45E']}>AWAITING_MERGE_APPROVAL</Pill>
            <span className="mono text-[10.5px] text-muted-2">
              corr: {DETAIL.correlation}
            </span>
          </div>
          <div
            className="text-[22px] font-semibold tracking-[-0.02em]"
            style={{ textWrap: 'pretty' }}
          >
            {DETAIL.title}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn">Request changes</button>
          <button className="btn-danger">Reject</button>
          <button className="btn-primary">Approve merge</button>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[1fr_328px]">
        <div className="card min-w-0 overflow-hidden">
          <div className="card-head">
            <Tabs tabs={TABS} active={tab} onSelect={onTab} />
          </div>

          {tab === 'plan' ? (
            <div className="p-[18px]">
              <SectionTitle
                title="Implementation plan"
                meta="v2 · approved by Andre B. · 08:04"
                right={
                  <Pill c={['#122E1E', '#6FD69C']}>COMPLEXITY: MODERATE</Pill>
                }
              />
              <div
                className="mt-3.5 mb-[18px] text-[13.5px] text-ink-3"
                style={{ lineHeight: 1.6, textWrap: 'pretty' }}
              >
                {DETAIL.planSummary}
              </div>

              <div className="grid grid-cols-1 gap-[18px] lg:grid-cols-2">
                <div>
                  <div className="label mb-[9px]">IMPLEMENTATION STEPS</div>
                  <div className="flex flex-col gap-[7px]">
                    {PLAN_STEPS.map((s) => (
                      <div key={s.n} className="flex items-baseline gap-[9px]">
                        <span className="mono text-[10px] text-accent">
                          {s.n}
                        </span>
                        <span
                          className="text-[12.5px] text-ink-3"
                          style={{ lineHeight: 1.55 }}
                        >
                          {s.text}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-4">
                  <div>
                    <div className="label mb-[9px]">ASSUMPTIONS</div>
                    <div className="flex flex-col gap-1.5">
                      {ASSUMPTIONS.map((a) => (
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
                  <div>
                    <div className="label mb-[9px]">ROLLBACK</div>
                    <div
                      className="text-[12.5px] text-muted"
                      style={{ lineHeight: 1.55 }}
                    >
                      {DETAIL.rollback}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {tab === 'diff' ? (
            <div className="p-[18px]">
              <SectionTitle
                title="File changes"
                right={
                  <div className="mono text-[10px] text-muted-2">
                    {DETAIL.limitLabel}
                  </div>
                }
              />
              <div className="mono mt-1 mb-3.5 text-[11px]">
                <span className="text-ok">+{DETAIL.additions}</span>{' '}
                <span className="text-danger">−{DETAIL.deletions}</span>
              </div>

              <div className="overflow-hidden rounded-lg border border-line">
                {FILES.map((f) => (
                  <div
                    key={f.path}
                    className="flex flex-wrap items-center gap-3 border-b border-line-faint px-3.5 py-2.5 last:border-b-0"
                  >
                    <span
                      className="mono w-[70px] shrink-0 text-[9.5px]"
                      style={{ color: f.actionFg }}
                    >
                      {f.action}
                    </span>
                    <span className="mono min-w-0 flex-1 truncate text-[11.5px] text-ink-2">
                      {f.path}
                    </span>
                    <span className="mono text-[10.5px] text-muted-2">
                      +{f.add} / −{f.del}
                    </span>
                    <div className="flex w-[60px] items-center gap-px">
                      <span
                        className="h-[6px] rounded-[1px] bg-ok"
                        style={{ width: f.addW }}
                      />
                      <span
                        className="h-[6px] rounded-[1px] bg-danger"
                        style={{ width: f.delW }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-3.5 rounded-lg border border-line bg-raised p-3.5">
                <div className="label mb-2">REVIEW AGENT VERDICT</div>
                <div
                  className="text-[12.5px] text-ink-3"
                  style={{ lineHeight: 1.6 }}
                >
                  {DETAIL.review}
                </div>
              </div>
            </div>
          ) : null}

          {tab === 'checks' ? (
            <div className="p-[18px]">
              <div className="mb-3.5 text-[13px] font-semibold">
                Validation runs
              </div>
              <div className="overflow-hidden rounded-lg border border-line">
                {COMMANDS.map((c, i) => (
                  <div
                    key={`${c.type}-${i}`}
                    className="flex flex-wrap items-center gap-3 border-b border-line-faint px-3.5 py-2.5 last:border-b-0"
                  >
                    <span className="mono w-[120px] shrink-0 text-[9.5px] text-muted-2">
                      {c.type}
                    </span>
                    <span className="mono min-w-0 flex-1 truncate text-[11.5px] text-ink-2">
                      {c.cmd}
                    </span>
                    <span className="mono text-[10.5px] text-muted-2">
                      exit {c.exit}
                    </span>
                    <span className="mono w-[56px] text-right text-[10.5px] text-muted">
                      {c.dur}
                    </span>
                    <Pill c={c.c}>{c.status}</Pill>
                  </div>
                ))}
              </div>

              <div className="mt-3.5">
                <div className="label mb-2">SANITISED OUTPUT · npm run build</div>
                <CodeBlock lines={LOG_LINES} />
              </div>
            </div>
          ) : null}

          {tab === 'request' ? (
            <div className="grid grid-cols-1 gap-[18px] p-[18px] lg:grid-cols-2">
              <div>
                <div className="label mb-2">ORIGINAL REQUEST</div>
                <div
                  className="mb-4 text-[13.5px] text-ink-3"
                  style={{ lineHeight: 1.6 }}
                >
                  {DETAIL.description}
                </div>
                <div className="label mb-2">ACCEPTANCE CRITERIA</div>
                <div className="flex flex-col gap-1.5">
                  {CRITERIA.map((c) => (
                    <div key={c} className="flex items-baseline gap-2.5">
                      <span className="text-[11px] text-ok">✓</span>
                      <span
                        className="text-[12.5px] text-ink-3"
                        style={{ lineHeight: 1.55 }}
                      >
                        {c}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="label mb-2">SUBMISSION PAYLOAD</div>
                <CodeBlock lines={PAYLOAD_LINES} />
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
                {EVENTS.map((e, i) => (
                  <div key={e.time} className="flex gap-3">
                    <div className="mono w-[62px] shrink-0 pt-px text-[10.5px] text-muted-2">
                      {e.time}
                    </div>
                    <div className="flex flex-col items-center">
                      <div
                        className="mt-1 size-[7px] shrink-0 rounded-full"
                        style={{ background: e.dot }}
                      />
                      {i < EVENTS.length - 1 ? (
                        <div className="w-px flex-1 bg-line" />
                      ) : null}
                    </div>
                    <div className="pb-3.5">
                      <div className="mono text-[10.5px] text-ink-2">
                        {e.type}
                      </div>
                      <div className="text-[12px] text-muted">{e.message}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {/* ---- right rail ---- */}
        <div className="flex flex-col gap-4">
          <Rail title="PIPELINE">
            <div className="flex flex-col">
              {STAGES.map((st, i) => (
                <div key={st.label} className="flex gap-2.5">
                  <div className="flex flex-col items-center">
                    <div
                      className="size-2.5 shrink-0 rounded-full border-2"
                      style={{ borderColor: st.ring, background: st.fill }}
                    />
                    {i < STAGES.length - 1 ? (
                      <div className="w-px flex-1 bg-line" />
                    ) : null}
                  </div>
                  <div className="flex flex-1 items-baseline justify-between gap-2 pb-3">
                    <div className="text-[12px]" style={{ color: st.fg }}>
                      {st.label}
                    </div>
                    <div className="mono text-[10px] text-muted-2">
                      {st.meta}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Rail>

          <Rail title="ARTEFACTS">
            <div className="flex flex-col gap-2.5">
              {ARTEFACTS.map((a) => (
                <div key={a.label}>
                  <ColLabel>{a.label}</ColLabel>
                  <div
                    className="mono break-all text-[11px]"
                    style={{ color: a.color }}
                  >
                    {a.value}
                  </div>
                </div>
              ))}
            </div>
          </Rail>

          <Rail title="AI USAGE">
            <div className="flex flex-col gap-1.5">
              {USAGE_ROWS.map((u) => (
                <div
                  key={u.label}
                  className="flex items-baseline justify-between gap-3"
                >
                  <span className="text-[11.5px] text-muted">{u.label}</span>
                  <span className="mono text-[11px] text-ink-2">{u.value}</span>
                </div>
              ))}
            </div>
            <div className="mt-3.5 border-t border-line-faint pt-3">
              <div className="mb-1.5 flex justify-between">
                <span className="text-[11.5px] text-muted">Budget used</span>
                <span className="mono text-[11px] text-ink-2">
                  {DETAIL.budgetPct}
                </span>
              </div>
              <Bar pct={DETAIL.budgetPct} color="#7C9CF5" />
            </div>
          </Rail>

          <Rail title="GUARDRAILS HELD">
            <div className="flex flex-col gap-2">
              {GUARDRAILS_HELD.map((g) => (
                <div
                  key={g}
                  className="text-[11.5px] text-muted"
                  style={{ lineHeight: 1.5 }}
                >
                  {g}
                </div>
              ))}
            </div>
          </Rail>
        </div>
      </div>
    </div>
  );
}
