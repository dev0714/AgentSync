'use client';

import { useEffect, useState } from 'react';
import type { Overview } from '@/lib/portal-data';
import { compact, money, statusLabel } from '@/lib/portal-ui';

type Ticket = {
  task_id: string;
  reference: string;
  title: string;
  status: string;
  project: string;
  planner: number | null;
  engineer: number | null;
  reviewer: number | null;
  other: number | null;
  tokens: number;
  cost: number;
  total_cost: number | null;
  last_at: string;
};

type Detail = {
  days: { day: string; anthropic: number; openai: number }[];
  agents: { name: string; model: string | null; tokens: number; cost: number }[];
  projects: { id: string; name: string; tasks: number; cost: number }[];
  tickets?: Ticket[];
  project_options?: { id: string; name: string }[];
  totals?: { cost: number; input_tokens: number; output_tokens: number; failover_calls: number };
  finished_tasks: number;
};

const PROJECT_KEY = 'agentsync.usage.project';

/**
 * What the agents cost this month: the totals, spend by day (Anthropic, and
 * OpenAI when it took over), and spend by project, by agent and by ticket —
 * for the whole tenant or one project.
 */
export default function Usage({
  usage,
  tenantSlug,
  onOpenTask,
}: {
  usage: Overview['usage'];
  tenantSlug: string | null;
  onOpenTask?: (id: string) => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [failed, setFailed] = useState(false);
  const [project, setProject] = useState('');
  const [ready, setReady] = useState(false);
  const [options, setOptions] = useState<{ id: string; name: string }[]>([]);

  // The project picked last time, read once the page is in the browser.
  useEffect(() => {
    try {
      setProject(window.localStorage.getItem(PROJECT_KEY) ?? '');
    } catch {
      /* private window: start with every project */
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    let live = true;
    setDetail(null);
    setFailed(false);
    const q = `tenant=${encodeURIComponent(tenantSlug ?? '')}${project ? `&project=${encodeURIComponent(project)}` : ''}`;
    fetch(`/api/portal/usage?${q}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Detail) => {
        if (!live) return;
        setDetail(d);
        if (d.project_options) setOptions(d.project_options);
      })
      .catch(() => {
        if (!live) return;
        // A remembered project from another tenant: fall back to all of them.
        if (project) pick('');
        else setFailed(true);
      });
    return () => { live = false; };
  }, [tenantSlug, project, ready]);

  function pick(id: string) {
    setProject(id);
    try {
      if (id) window.localStorage.setItem(PROJECT_KEY, id);
      else window.localStorage.removeItem(PROJECT_KEY);
    } catch {
      /* remembering is a convenience */
    }
  }

  // One project: the month's figures come from the detail; all of them: the overview.
  const scoped = !!project;
  const totals = scoped ? detail?.totals : undefined;
  const budget = scoped ? 0 : Number(usage.budget) || 0;
  const spent = scoped ? Number(totals?.cost ?? 0) : Number(usage.month_cost) || 0;
  const projectName = options.find((o) => o.id === project)?.name ?? null;
  const days = detail?.days ?? [];
  const today = new Date();
  const daysInMonth = new Date(today.getUTCFullYear(), today.getUTCMonth() + 1, 0).getDate();
  const projected = days.length > 0 ? (spent / days.length) * daysInMonth : 0;
  const perTask = detail && detail.finished_tasks > 0 ? spent / detail.finished_tasks : null;
  const peak = Math.max(1, ...days.map((d) => Number(d.anthropic) + Number(d.openai)));
  const scale = niceMax(peak);
  const hasFailover = days.some((d) => Number(d.openai) > 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2.5">
          <span className="text-[13.5px] font-medium text-ink-2">Project</span>
          <select className="field-select min-w-[200px]" value={project} onChange={(e) => pick(e.target.value)} aria-label="Show usage for">
            <option value="">All projects</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
            {project && !options.some((o) => o.id === project) ? <option value={project}>This project</option> : null}
          </select>
        </label>
        <span className="text-[13px] text-muted-3">
          {scoped ? `Showing ${projectName ?? 'one project'} only, this month` : 'Showing every project, this month'}
        </span>
      </div>

      <section aria-label="This month" className="card grid grid-cols-2 lg:grid-cols-[1.4fr_repeat(4,minmax(0,1fr))]">
        <div className="col-span-2 flex flex-col gap-2 px-5 py-4 lg:col-span-1">
          <span className="text-[12.5px] font-medium text-muted-3">Spend this month</span>
          <span className="flex items-baseline gap-2">
            <span className="text-[28px] leading-tight font-semibold tracking-[-0.02em] tabular-nums">{money(spent)}</span>
            <span className="text-[13px] text-muted-3">
              {scoped ? 'for this project' : budget > 0 ? `of ${money(budget)} budget` : 'no budget set'}
            </span>
          </span>
          {budget > 0 ? (
            <span aria-hidden="true" className="h-1.5 overflow-hidden rounded-[3px] bg-line-soft">
              <span
                className="block h-full"
                style={{ width: `${Math.min(100, (spent / budget) * 100)}%`, background: spent > budget ? 'var(--color-danger)' : 'var(--color-ink-3)' }}
              />
            </span>
          ) : null}
          <span className="text-[12.5px] text-muted-3">
            {days.length > 1 ? `About ${money(projected)} by month end at this rate` : 'Projection appears after a few days of use'}
          </span>
        </div>
        <Kpi label="Tasks finished" value={detail ? String(detail.finished_tasks) : '—'} note={perTask !== null ? `${money(perTask)} each on average` : 'this month'} />
        <Kpi label="Input tokens" value={scoped ? (totals ? compact(totals.input_tokens) : '—') : compact(usage.month_input_tokens)} note="this month" />
        <Kpi label="Output tokens" value={scoped ? (totals ? compact(totals.output_tokens) : '—') : compact(usage.month_output_tokens)} note="plans, code and reviews" />
        <Kpi label="Failover calls" value={scoped ? (totals ? String(totals.failover_calls) : '—') : String(usage.failover_calls)} note="the other provider took over" />
      </section>

      <section aria-labelledby="daily-h" className="card flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center gap-4">
          <h2 id="daily-h" className="m-0 flex-1 text-[15px] font-semibold">Spend by day</h2>
          <Legend colour="var(--color-accent)" label="Anthropic" />
          {hasFailover ? <Legend colour="var(--color-caution-ink)" label="OpenAI (failover)" /> : null}
        </div>
        {failed ? (
          <p className="m-0 text-[14px] text-muted-3">The daily breakdown could not be loaded. The totals above are current.</p>
        ) : !detail ? (
          <div className="h-[170px] animate-pulse rounded-md bg-line-faint" />
        ) : (
          <>
            <div className="flex gap-2.5">
              <div aria-hidden="true" className="flex h-[170px] w-9 flex-col justify-between text-right text-[11.5px] text-muted-3 tabular-nums">
                <span>{money(scale).replace('.00', '')}</span>
                <span>{money(scale / 2).replace('.00', '')}</span>
                <span>$0</span>
              </div>
              <div
                role="img"
                aria-label={`Daily spend this month: ${money(spent)} over ${days.length} days, highest ${money(peak === 1 && spent === 0 ? 0 : peak)} in a day`}
                className="flex h-[170px] flex-1 items-end gap-[3px] border-b border-line-strong sm:gap-1.5"
                style={{ backgroundImage: 'linear-gradient(var(--color-line-faint) 1px, transparent 1px)', backgroundSize: '100% 85px' }}
              >
                {days.map((d) => {
                  const a = Number(d.anthropic), o = Number(d.openai);
                  return (
                    <div key={d.day} className="flex h-full flex-1 flex-col justify-end" title={`${d.day}: ${money(a + o)}`}>
                      {o > 0 ? <div className="rounded-t-[2px]" style={{ height: `${(o / scale) * 100}%`, background: 'var(--color-caution-ink)' }} /> : null}
                      {a > 0 ? <div className={o > 0 ? '' : 'rounded-t-[2px]'} style={{ height: `${(a / scale) * 100}%`, background: 'var(--color-accent)' }} /> : null}
                    </div>
                  );
                })}
              </div>
            </div>
            <div aria-hidden="true" className="flex justify-between pl-[46px] text-[11.5px] text-muted-3 tabular-nums">
              <span>{fmtDay(days[0]?.day)}</span>
              <span>{fmtDay(days[Math.floor((days.length - 1) / 2)]?.day)}</span>
              <span>{fmtDay(days[days.length - 1]?.day)}</span>
            </div>
          </>
        )}
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section aria-labelledby="proj-h" className="card overflow-hidden">
          <h2 id="proj-h" className="m-0 border-b border-line-soft px-5 py-3 text-[15px] font-semibold">By project</h2>
          {!detail?.projects.length ? (
            <p className="m-0 px-5 py-4 text-[14px] text-muted-3">No spend this month yet.</p>
          ) : (
            detail.projects.map((p) => {
              const max = Math.max(...detail.projects.map((x) => Number(x.cost)), 0.0001);
              return (
                <div key={p.id ?? p.name} className="grid grid-cols-[minmax(0,140px)_1fr_72px_84px] items-center gap-3.5 border-b border-line-faint px-5 py-3 last:border-0">
                  <span className="truncate font-medium">{p.name}</span>
                  <span aria-hidden="true" className="h-1.5 overflow-hidden rounded-[3px] bg-line-soft">
                    <span className="block h-full bg-ink-3" style={{ width: `${(Number(p.cost) / max) * 100}%` }} />
                  </span>
                  <span className="text-[12.5px] text-muted-3 tabular-nums">{p.tasks} task{Number(p.tasks) === 1 ? '' : 's'}</span>
                  <span className="text-right font-medium tabular-nums">{money(p.cost)}</span>
                </div>
              );
            })
          )}
        </section>
        <section aria-labelledby="agent-h" className="card overflow-hidden">
          <h2 id="agent-h" className="m-0 border-b border-line-soft px-5 py-3 text-[15px] font-semibold">By agent</h2>
          {!detail?.agents.length ? (
            <p className="m-0 px-5 py-4 text-[14px] text-muted-3">No spend this month yet.</p>
          ) : (
            detail.agents.map((a) => (
              <div key={a.name} className="grid grid-cols-[110px_minmax(0,1fr)_90px_84px] items-center gap-3.5 border-b border-line-faint px-5 py-3 last:border-0">
                <span className="truncate font-medium">{a.name}</span>
                <span className="mono truncate text-[12px] text-muted-3">{a.model ?? '—'}</span>
                <span className="text-[12.5px] text-muted-3 tabular-nums">{compact(a.tokens)} tok</span>
                <span className="text-right font-medium tabular-nums">{money(a.cost)}</span>
              </div>
            ))
          )}
        </section>
      </div>

      <Tickets tickets={detail?.tickets ?? null} showProject={!scoped} onOpenTask={onOpenTask} />
    </div>
  );
}

/** A ticket's number (TK-123) from its title, and the rest of the title. */
function ticketOf(t: Ticket): { ref: string; title: string } {
  const m = /^\s*([A-Z][A-Z0-9]*-\d+)\s*[:\-–—]?\s*(.*)$/.exec(t.title);
  if (m) return { ref: m[1], title: m[2] || t.title };
  return { ref: t.reference.length > 12 ? t.reference.slice(0, 8) : t.reference, title: t.title };
}

/** What each ticket cost this month, split by agent, and in all. */
function Tickets({
  tickets,
  showProject,
  onOpenTask,
}: {
  tickets: Ticket[] | null;
  showProject: boolean;
  onOpenTask?: (id: string) => void;
}) {
  const cols = showProject
    ? 'md:grid-cols-[minmax(0,1.6fr)_minmax(0,0.8fr)_minmax(0,0.9fr)_72px_72px_72px_80px_80px]'
    : 'md:grid-cols-[minmax(0,1.6fr)_minmax(0,0.9fr)_72px_72px_72px_80px_80px]';
  const cell = (v: number | null) => (v ? money(v) : '—');
  return (
    <section aria-labelledby="ticket-h" className="card overflow-hidden">
      <div className="flex flex-wrap items-baseline gap-2 border-b border-line-soft px-5 py-3">
        <h2 id="ticket-h" className="m-0 text-[15px] font-semibold">By ticket</h2>
        <span className="text-[12.5px] text-muted-3">
          {tickets?.length ? `${tickets.length} ticket${tickets.length === 1 ? '' : 's'} with spend this month` : ''}
        </span>
      </div>
      {!tickets ? (
        <div className="m-5 h-[60px] animate-pulse rounded-md bg-line-faint" />
      ) : !tickets.length ? (
        <p className="m-0 px-5 py-4 text-[14px] text-muted-3">No spend this month yet.</p>
      ) : (
        <>
          <div className={`hidden gap-3.5 border-b border-line-soft px-5 py-2 text-[12px] font-medium text-muted-3 md:grid ${cols}`}>
            <span>Ticket</span>
            {showProject ? <span>Project</span> : null}
            <span>Status</span>
            <span className="text-right">Planner</span>
            <span className="text-right">Engineer</span>
            <span className="text-right">Reviewer</span>
            <span className="text-right">This month</span>
            <span className="text-right">Total</span>
          </div>
          <ul className="m-0 list-none p-0">
            {tickets.map((t) => {
              const k = ticketOf(t);
              const extra = Number(t.total_cost ?? 0) - Number(t.cost);
              return (
                <li key={t.task_id} className="border-b border-line-faint last:border-0">
                  <button
                    type="button"
                    disabled={!onOpenTask}
                    onClick={() => onOpenTask?.(t.task_id)}
                    className={`grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-1 px-5 py-3 text-left hover:bg-line-faint disabled:cursor-default ${cols}`}
                    title={t.other ? `Other agents: ${money(t.other)}` : undefined}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="mono text-[12.5px] font-semibold text-ink">{k.ref}</span>
                      <span className="truncate text-[13.5px] text-ink-2">{k.title}</span>
                    </span>
                    {showProject ? <span className="hidden truncate text-[13.5px] text-ink-2 md:block">{t.project}</span> : null}
                    <span className="hidden text-[13px] text-muted-3 md:block">{statusLabel(t.status)}</span>
                    <span className="hidden text-right text-[13.5px] tabular-nums text-ink-2 md:block">{cell(t.planner)}</span>
                    <span className="hidden text-right text-[13.5px] tabular-nums text-ink-2 md:block">{cell(t.engineer)}</span>
                    <span className="hidden text-right text-[13.5px] tabular-nums text-ink-2 md:block">{cell(t.reviewer)}</span>
                    <span className="row-span-2 text-right font-medium tabular-nums md:row-span-1">{money(t.cost)}</span>
                    <span className="hidden text-right text-[13.5px] tabular-nums text-muted-3 md:block" title={extra > 0.005 ? `${money(extra)} before this month` : undefined}>
                      {money(t.total_cost ?? t.cost)}
                    </span>
                    <span className="text-[12.5px] text-muted-3 md:hidden">
                      {[showProject ? t.project : null, statusLabel(t.status)].filter(Boolean).join(' · ')}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

function Kpi({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="flex flex-col gap-1.5 border-t border-line-soft px-5 py-4 lg:border-t-0 lg:border-l">
      <span className="text-[12.5px] font-medium text-muted-3">{label}</span>
      <span className="text-[22px] leading-tight font-semibold tracking-[-0.02em] tabular-nums">{value}</span>
      <span className="text-[12.5px] text-muted-3">{note}</span>
    </div>
  );
}

function Legend({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[12.5px] text-muted-3">
      <span className="size-2.5 rounded-[2px]" style={{ background: colour }} />
      {label}
    </span>
  );
}

/** A round number just above the peak, so the axis reads $5, $10, $20… */
function niceMax(v: number): number {
  const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
  return steps.find((s) => s >= v) ?? Math.ceil(v / 1000) * 1000;
}

function fmtDay(day: string | undefined): string {
  if (!day) return '';
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
