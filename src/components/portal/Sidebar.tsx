'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Icon, { type IconName } from '@/components/site/Icon';
import ThemedLogo from './ThemedLogo';
import type { Tenant, TenantSummary } from '@/lib/portal-data';
import type { PortalUser, Screen } from './Portal';

const NAV: { group: string; items: { icon: IconName; k: Screen; label: string }[] }[] =
  [
    {
      group: 'Operate',
      items: [
        { icon: 'tasks', k: 'tasks', label: 'Tasks' },
        { icon: 'approvals', k: 'approvals', label: 'Approvals' },
        { icon: 'deploy', k: 'deployments', label: 'Deployments' },
        { icon: 'audit', k: 'audit', label: 'Audit log' },
      ],
    },
    {
      group: 'Configure',
      items: [
        { icon: 'folder', k: 'project', label: 'Projects' },
        { icon: 'cpu', k: 'agents', label: 'Agents' },
        { icon: 'inbox', k: 'sources', label: 'Source systems' },
        { icon: 'chart', k: 'usage', label: 'Usage and cost' },
        { icon: 'plug', k: 'connections', label: 'Connections' },
      ],
    },
    {
      group: 'Platform',
      items: [{ icon: 'building', k: 'tenants', label: 'Tenants' }],
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
    : NAV.filter((s) => s.group !== 'Platform');

  return (
    <div className="flex w-[248px] shrink-0 flex-col overflow-hidden border-r border-line-soft bg-canvas-alt">
      <Link
        href="/"
        className="flex h-[60px] shrink-0 items-center gap-2.5 px-5 whitespace-nowrap no-underline hover:no-underline"
      >
        <ThemedLogo size={19} />
        <span className="text-[12px] text-muted-3">Control plane</span>
      </Link>

      <div className="px-3 pb-3">
        <button
          onClick={() => setOpen((v) => !v)}
          disabled={tenants.length < 2}
          aria-label={`Tenant: ${tenantName}${tenants.length > 1 ? ' (switch)' : ''}`}
          className="flex min-h-[44px] w-full cursor-pointer items-center gap-2.5 rounded-lg border border-line-soft bg-card px-2.5 py-2 text-left hover:border-line-strong disabled:cursor-default disabled:hover:border-line-soft"
        >
          <span
            className="mono flex size-6 shrink-0 items-center justify-center rounded-[5px] border border-line-soft bg-raised font-semibold text-ink-3"
            style={{ fontSize: 10.5 }}
          >
            {tenantName.slice(0, 2).toUpperCase()}
          </span>
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate text-[13.5px] font-semibold text-ink">{tenantName}</span>
            <span className="text-[11.5px] text-muted-3">Tenant</span>
          </span>
          {tenants.length > 1 ? (
            <Icon name="chevron" size={15} className="text-muted-3" />
          ) : null}
        </button>
        {open && tenants.length > 1 ? (
          <div className="mt-1.5 flex flex-col gap-px rounded-lg border border-line-soft bg-card p-1 shadow-sm">
            {tenants.map((t) => (
              <button
                key={t.slug}
                onClick={() => {
                  onTenant(t.slug);
                  setOpen(false);
                }}
                className="flex cursor-pointer justify-between gap-2 rounded-md px-[9px] py-2 text-[13.5px] text-ink-3 hover:bg-raised hover:text-ink"
              >
                <span className="truncate">{t.name}</span>
                <span className="mono text-[11.5px] text-muted-3">
                  {t.project_count} project{t.project_count === 1 ? '' : 's'}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <nav aria-label="Main" className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 py-1">
        {sections.map((section) => (
          <div key={section.group} className="flex flex-col gap-px">
            <div className="px-2.5 pb-1.5 text-[11.5px] font-medium text-muted-3">{section.group}</div>
            {section.items.map((item) => (
              <button
                key={item.k}
                onClick={() => onNavigate(item.k)}
                aria-current={isActive(item.k) ? 'page' : undefined}
                className={`flex min-h-[36px] cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-[14px] transition-colors ${
                  isActive(item.k)
                    ? 'bg-line-faint font-semibold text-ink'
                    : 'text-ink-3 hover:bg-line-faint hover:text-ink'
                }`}
              >
                <Icon name={item.icon} size={17} className={isActive(item.k) ? 'text-ink' : 'text-muted-3'} />
                <span className="flex-1 text-left">{item.label}</span>
                {/* Counts are shown only when there is something to count —
                    a badge reading 0 is noise, and one that is always there
                    stops meaning anything. */}
                {item.k === 'approvals' && pendingCount > 0 ? (
                  <span
                    className="flex h-5 min-w-5 items-center justify-center rounded-full bg-gate px-1.5 text-[11.5px] font-semibold text-on-gate"
                    aria-label={`${pendingCount} waiting for a person`}
                  >
                    {pendingCount}
                  </span>
                ) : null}
                {item.k === 'agents' && agentCount > 0 ? (
                  <span className="mono text-[11.5px] text-muted-3">{agentCount}</span>
                ) : null}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="flex items-center gap-2.5 border-t border-line-soft px-4 py-3">
        <div className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-agent-tint text-[12px] font-semibold text-agent-ink">
          {initials(user.name)}
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[13px] font-medium text-ink">{user.name}</div>
          <div className="truncate text-[11.5px] text-muted-3">{user.role}</div>
        </div>
        <button
          onClick={signOut}
          disabled={signingOut}
          className="h-[30px] shrink-0 cursor-pointer rounded-md border border-line-soft px-2.5 text-[12.5px] text-ink-3 hover:border-danger-line hover:bg-danger-tint hover:text-danger-ink disabled:cursor-default disabled:opacity-50"
        >
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </div>
  );
}
