'use client';

import {
  CONN_ALERTS,
  CONN_CARDS,
  CONN_TABS,
  CONN_TILES,
  GH_PERMS,
  HOOKS,
  SECRETS,
  type ConnTab,
} from '@/data/portal';
import { ColLabel, FieldRows, Pill, Tabs } from '../ui';

export default function Connections({
  tab,
  onTab,
}: {
  tab: ConnTab;
  onTab: (t: ConnTab) => void;
}) {
  const cards =
    tab === 'overview' ? CONN_CARDS : CONN_CARDS.filter((c) => c.k === tab);

  return (
    <div className="flex flex-col gap-4">
      <div className="text-[12.5px] text-muted" style={{ lineHeight: 1.6 }}>
        Every external system AgentSync talks to. Credentials are never stored
        here in plain text — each connection holds a reference into the secret
        manager, and any one of them can be disabled without touching project
        configuration.
      </div>

      <div className="border-b border-line">
        <Tabs tabs={CONN_TABS} active={tab} onSelect={onTab} />
      </div>

      {tab === 'overview' ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {CONN_TILES.map((ct) => (
            <div key={ct.name} className="card flex flex-col gap-2 p-4">
              <div className="flex items-center gap-2">
                <span
                  className="size-1.5 rounded-full"
                  style={{ background: ct.dot }}
                />
                <span className="flex-1 text-[13.5px] font-semibold">
                  {ct.name}
                </span>
                <Pill c={ct.c}>{ct.state}</Pill>
              </div>
              <div className="mono text-[10.5px] text-ink-3">{ct.target}</div>
              <div className="text-[11.5px] text-muted" style={{ lineHeight: 1.5 }}>
                {ct.meta}
              </div>
              <div className="mt-1 flex items-center gap-2">
                <button className="btn !px-3 !py-1.5 !text-[11.5px]">
                  Test
                </button>
                <button className="btn !px-3 !py-1.5 !text-[11.5px]">
                  Configure
                </button>
                <div className="flex-1" />
                <button className="mono cursor-pointer text-[10.5px] text-muted-2 hover:text-danger">
                  Disable
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {cards.map((c) => (
        <div
          key={c.k}
          className="card overflow-hidden"
          style={{ maxWidth: tab === 'overview' ? 'none' : 760 }}
        >
          <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
            <div className="text-[13px] font-semibold">{c.title}</div>
            <div className="mono text-[10px] text-muted-2">{c.scope}</div>
          </div>
          <div className="p-4">
            <FieldRows prefix={`conn.${c.title}`} rows={c.rows} />
          </div>
        </div>
      ))}

      {tab === 'github' ? (
        <div className="card overflow-hidden" style={{ maxWidth: 760 }}>
          <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
            <div className="text-[13px] font-semibold">
              GitHub App permissions
            </div>
            <div className="mono text-[10px] text-muted-2">
              least privilege · 3 repositories
            </div>
          </div>
          <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
            {GH_PERMS.map((p) => (
              <div
                key={p.scope}
                className="flex items-center justify-between gap-3 border-b border-line-faint px-4 py-2.5"
              >
                <div className="mono text-[11.5px] text-ink-2">{p.scope}</div>
                <Pill c={p.c}>{p.level}</Pill>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {tab === 'webhooks' ? (
        <div className="card overflow-hidden">
          <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
            <div className="text-[13px] font-semibold">Webhook endpoints</div>
            <div className="mono text-[10px] text-muted-2">
              signed · replay window 300s
            </div>
          </div>
          {HOOKS.map((h) => (
            <div
              key={h.path}
              className="flex flex-wrap items-center gap-3 border-b border-line-faint px-4 py-2.5 last:border-b-0"
            >
              <div
                className="mono w-8 shrink-0 text-[10px]"
                style={{ color: h.dirFg }}
              >
                {h.dir}
              </div>
              <div className="min-w-0 flex-1">
                <div className="mono truncate text-[11.5px] text-ink-2">
                  {h.path}
                </div>
                <div className="text-[11px] text-muted-2">{h.note}</div>
              </div>
              <div
                className="mono text-[10.5px]"
                style={{ color: h.statFg }}
              >
                {h.stat}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {tab === 'secrets' ? (
        <div className="card overflow-hidden">
          <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
            <div className="text-[13px] font-semibold">Secret references</div>
            <div className="mono text-[10px] text-muted-2">
              values never leave the secret manager
            </div>
          </div>
          <div className="overflow-x-auto">
            <div className="grid min-w-[720px] grid-cols-[minmax(280px,1fr)_160px_120px_90px] gap-3 border-b border-line bg-raised px-4 py-[9px]">
              <ColLabel>REFERENCE</ColLabel>
              <ColLabel>USED BY</ColLabel>
              <ColLabel>ROTATED</ColLabel>
              <ColLabel right>STATE</ColLabel>
            </div>
            {SECRETS.map((sr) => (
              <div
                key={sr.ref}
                className="grid min-w-[720px] grid-cols-[minmax(280px,1fr)_160px_120px_90px] items-center gap-3 border-b border-line-faint px-4 py-2.5"
              >
                <div className="mono truncate text-[11px] text-ink-2">
                  {sr.ref}
                </div>
                <div className="text-[12px] text-muted">{sr.used}</div>
                <div className="mono text-[10.5px] text-muted-2">
                  {sr.rotated}
                </div>
                <div className="text-right">
                  <Pill c={sr.c}>{sr.state}</Pill>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {tab === 'overview' ? (
        <div
          className="rounded-lg border p-4"
          style={{ borderColor: '#4A3616', background: '#1A1408' }}
        >
          <div className="mb-2 flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-[#F0654A]" />
            <div className="text-[12.5px] font-semibold text-warn-2">
              2 connections need attention
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            {CONN_ALERTS.map((a) => (
              <div
                key={a}
                className="text-[12px] text-muted"
                style={{ lineHeight: 1.55 }}
              >
                {a}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
