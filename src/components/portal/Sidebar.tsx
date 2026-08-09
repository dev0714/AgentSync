'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Tenant, TenantSummary } from '@/lib/portal-data';
import type { PortalUser, Screen } from './Portal';

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

/** Two-letter monogram from a display name: "Andre Dharmalingam" → "AD". */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '··';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function Sidebar({
  screen,
  onNavigate,
  tenants,
  currentTenant,
  onTenant,
  pendingCount,
  agentCount,
  isPlatformAdmin,
  user,
}: {
  screen: Screen;
  onNavigate: (s: Screen) => void;
  tenants: TenantSummary[];
  currentTenant: Tenant | null;
  onTenant: (slug: string) => void;
  pendingCount: number;
  agentCount: number;
  isPlatformAdmin: boolean;
  user: PortalUser;
}) {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const router = useRouter();

  // Clears the session cookie, then returns to the sign-in screen.
  async function signOut() {
    setSigningOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      router.replace('/login');
      router.refresh();
    }
  }

  const isActive = (k: Screen) =>
    screen === k || (k === 'tasks' && screen === 'detail');

  const tenantName = currentTenant?.name ?? 'No tenant';
  const sections = isPlatformAdmin
    ? NAV
    : NAV.filter((s) => s.group !== 'PLATFORM');

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
          disabled={tenants.length < 2}
          className="flex w-full cursor-pointer items-center gap-[9px] rounded-[7px] border border-[#2A2A2F] bg-raised px-2.5 py-[9px] hover:border-[#2E2E33] disabled:cursor-default"
        >
          <div
            className="mono flex size-[18px] items-center justify-center rounded-[5px] bg-[#2E2E33] font-semibold text-[#D6D6DC]"
            style={{ fontSize: 9 }}
          >
            {tenantName.slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 truncate text-left text-[12.5px] font-medium text-ink-2">
            {tenantName}
          </div>
          {tenants.length > 1 ? (
            <div className="text-[9px] text-muted-2">▾</div>
          ) : null}
        </button>
        {open && tenants.length > 1 ? (
          <div className="mt-1.5 flex flex-col gap-px rounded-[7px] border border-[#2A2A2F] bg-raised p-1">
            {tenants.map((t) => (
              <button
                key={t.slug}
                onClick={() => {
                  onTenant(t.slug);
                  setOpen(false);
                }}
                className="flex cursor-pointer justify-between gap-2 rounded-[5px] px-[9px] py-[7px] text-xs text-ink-3 hover:bg-[#242429] hover:text-ink"
              >
                <span className="truncate">{t.name}</span>
                <span className="mono text-[10px] text-muted-2">
                  {t.project_count} project{t.project_count === 1 ? '' : 's'}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-2.5">
        {sections.map((section) => (
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
                {/* Counts are shown only when there is something to count —
                    a badge reading 0 is noise, and one that is always there
                    stops meaning anything. */}
                {item.k === 'approvals' && pendingCount > 0 ? (
                  <span
                    className="mono rounded-[20px] bg-[#F0654A] px-1.5 py-px text-white"
                    style={{ fontSize: 10 }}
                  >
                    {pendingCount}
                  </span>
                ) : null}
                {item.k === 'agents' && agentCount > 0 ? (
                  <span className="mono text-[10px] text-muted-2">
                    {agentCount}
                  </span>
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
        <div className="flex size-[26px] shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-canvas">
          {initials(user.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-ink-2">
            {user.name}
          </div>
          <div className="mono truncate text-muted-2" style={{ fontSize: 9.5 }}>
            {user.role}
          </div>
        </div>
        <button
          onClick={signOut}
          disabled={signingOut}
          title="Sign out"
          aria-label="Sign out"
          className="flex size-[26px] shrink-0 cursor-pointer items-center justify-center rounded-md border border-line text-muted-2 hover:border-[#452020] hover:bg-[#2A1512] hover:text-danger disabled:cursor-default disabled:opacity-50"
        >
          {/* door with an outbound arrow */}
          <svg
            width="13"
            height="13"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M6 14H3.5A1.5 1.5 0 0 1 2 12.5v-9A1.5 1.5 0 0 1 3.5 2H6" />
            <path d="M10.5 11 14 8l-3.5-3" />
            <path d="M14 8H6" />
          </svg>
        </button>
      </div>
    </div>
  );
}
