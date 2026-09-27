'use client';

import { useEffect, useState } from 'react';
import type { Overview } from '@/lib/portal-data';
import { compact, money } from '@/lib/portal-ui';

type Detail = {
  days: { day: string; anthropic: number; openai: number }[];
  agents: { name: string; model: string | null; tokens: number; cost: number }[];
  projects: { name: string; tasks: number; cost: number }[];
  finished_tasks: number;
};

/**
 * What the agents cost this month: the totals, spend by day (Anthropic, and
 * OpenAI when it took over), and spend by project and by agent.
 */
export default function Usage({ usage, tenantSlug }: { usage: Overview['usage']; tenantSlug: string | null }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/portal/usage?tenant=${encodeURIComponent(tenantSlug ?? '')}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Detail) => { if (live) setDetail(d); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [tenantSlug]);

  const budget = Number(usage.budget) || 0;
  const spent = Number(usage.month_cost) || 0;
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
      <section aria-label="This month" className="card grid grid-cols-2 lg:grid-cols-[1.4fr_repeat(4,minmax(0,1fr))]">
        <div className="col-span-2 flex flex-col gap-2 px-5 py-4 lg:col-span-1">
          <span className="text-[12.5px] font-medium text-muted-3">Spend this month</span>
          <span className="flex items-baseline gap-2">
            <span className="text-[28px] leading-tight font-semibold tracking-[-0.02em] tabular-nums">{money(spent)}</span>
            <span className="text-[13px] text-muted-3">{budget > 0 ? `of ${money(budget)} budget` : 'no budget set'}</span>
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
        <Kpi label="Input tokens" value={compact(usage.month_input_tokens)} note="this month" />
        <Kpi label="Output tokens" value={compact(usage.month_output_tokens)} note="plans, code and reviews" />
        <Kpi label="Failover calls" value={String(usage.failover_calls)} note="the other provider took over" />
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
                <div key={p.name} className="grid grid-cols-[minmax(0,140px)_1fr_72px_84px] items-center gap-3.5 border-b border-line-faint px-5 py-3 last:border-0">
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
    </div>
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
