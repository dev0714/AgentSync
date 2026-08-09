'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { Screen } from './Portal';

const NAV: { group: string; items: { n: string; k: Screen; label: string }[] }[] =
  [
    {
      group: 'OPERATE',
      items: [
        { n: '01', k: 'tasks', label: 'Tasks' },
        { n: '02', k: 'approvals', label: 'Approvals' },
        { n: '03', k: 'deployments', label: 'Deployments' },
        { n: '04', k: 'audit', label: 'Audit log' },
      ],
    },
    {
      group: 'CONFIGURE',
      items: [
        { n: '05', k: 'project', label: 'Projects' },
        { n: '06', k: 'agents', label: 'Agents' },
        { n: '07', k: 'sources', label: 'Source systems' },
        { n: '08', k: 'usage', label: 'Usage & cost' },
        { n: '09', k: 'connections', label: 'Connections' },
      ],
    },
    {
      group: 'PLATFORM',
      items: [{ n: '10', k: 'tenants', label: 'Tenants' }],
    },
  ];

const TENANT_LIST = [
  { name: 'Northwind Group', projects: '6 projects' },
  { name: 'Meridian Health', projects: '3 projects' },
  { name: 'Cape Logistics', projects: '2 projects' },
  { name: 'Internal · AgentSync', projects: '1 project' },
];

export default function Sidebar({
  screen,
  onNavigate,
  tenant,
  onTenant,
  pendingCount,
}: {
  screen: Screen;
  onNavigate: (s: Screen) => void;
  tenant: string;
  onTenant: (t: string) => void;
  pendingCount: number;
}) {
  const [open, setOpen] = useState(false);

  const isActive = (k: Screen) =>
    screen === k || (k === 'tasks' && screen === 'detail');

  return (
    <div className="flex w-[238px] shrink-0 flex-col overflow-hidden bg-surface">
      <Link
        href="/"
        className="flex items-center gap-2.5 border-b border-line px-[18px] pt-5 pb-4 no-underline hover:no-underline"
      >
        <div
          className="mono flex size-[26px] items-center justify-center rounded-[7px] bg-accent font-semibold text-canvas"
          style={{ fontSize: 13 }}
        >
          A
        </div>
        <div className="flex flex-col gap-px">
          <div className="text-sm font-semibold tracking-[-0.01em] text-ink">
            AgentSync
          </div>
          <div
            className="mono text-muted-2"
            style={{ fontSize: 9, letterSpacing: '0.06em' }}
          >
            CONTROL PLANE
          </div>
        </div>
      </Link>

      <div className="px-3 pt-3.5 pb-2">
        <div
          className="mono px-2 pb-2 text-[#66666F]"
          style={{ fontSize: 9, letterSpacing: '0.1em' }}
        >
          TENANT
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex w-full cursor-pointer items-center gap-[9px] rounded-[7px] border border-[#2A2A2F] bg-raised px-2.5 py-[9px] hover:border-[#2E2E33]"
        >
          <div
            className="mono flex size-[18px] items-center justify-center rounded-[5px] bg-[#2E2E33] font-semibold text-[#D6D6DC]"
            style={{ fontSize: 9 }}
          >
            {tenant.slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 truncate text-left text-[12.5px] font-medium text-ink-2">
            {tenant}
          </div>
          <div className="text-[9px] text-muted-2">▾</div>
        </button>
        {open ? (
          <div className="mt-1.5 flex flex-col gap-px rounded-[7px] border border-[#2A2A2F] bg-raised p-1">
            {TENANT_LIST.map((t) => (
              <button
                key={t.name}
                onClick={() => {
                  onTenant(t.name);
                  setOpen(false);
                }}
                className="flex cursor-pointer justify-between gap-2 rounded-[5px] px-[9px] py-[7px] text-xs text-ink-3 hover:bg-[#242429] hover:text-ink"
              >
                <span className="truncate">{t.name}</span>
                <span className="mono text-[10px] text-muted-2">
                  {t.projects}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-2.5">
        {NAV.map((section) => (
          <div key={section.group} className="flex flex-col gap-0.5">
            <div
              className="mono px-2 pt-[18px] pb-2 text-[#66666F]"
              style={{ fontSize: 9, letterSpacing: '0.1em' }}
            >
              {section.group}
            </div>
            {section.items.map((item) => (
              <button
                key={item.k}
                onClick={() => onNavigate(item.k)}
                className="flex cursor-pointer items-center gap-2.5 rounded-[7px] px-2.5 py-2 text-[13px] font-medium"
                style={{
                  background: isActive(item.k) ? '#242429' : 'transparent',
                  color: isActive(item.k) ? '#F2F2F4' : '#9A9AA3',
                }}
              >
                <span className="mono text-[11px] opacity-60">{item.n}</span>
                <span className="flex-1 text-left">{item.label}</span>
                {item.k === 'tasks' ? (
                  <span
                    className="mono rounded-[20px] bg-[#F0654A] px-1.5 py-px text-white"
                    style={{ fontSize: 10 }}
                  >
                    {pendingCount}
                  </span>
                ) : null}
                {item.k === 'agents' ? (
                  <span className="mono text-[10px] text-muted-2">7</span>
                ) : null}
                {item.k === 'connections' ? (
                  <span className="size-1.5 rounded-full bg-[#F0654A]" />
                ) : null}
                {item.k === 'tenants' ? (
                  <span
                    className="mono rounded bg-[#132430] px-1.5 py-px text-[#7FB6E0]"
                    style={{ fontSize: 9 }}
                  >
                    SA
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="flex items-center gap-[9px] border-t border-line p-3">
        <div className="flex size-[26px] items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-canvas">
          AB
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-ink-2">Andre B.</div>
          <div className="mono text-muted-2" style={{ fontSize: 9.5 }}>
            SUPER_ADMIN
          </div>
        </div>
      </div>
    </div>
  );
}
