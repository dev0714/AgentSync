'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Icon, { Logo, type IconName } from '@/components/site/Icon';
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
        { icon: 'chart', k: 'usage', label: 'Usage & cost' },
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
    <div className="flex w-[248px] shrink-0 flex-col overflow-hidden border-r border-line bg-canvas-alt">
      <Link
        href="/"
        className="flex flex-col gap-1 px-5 pt-5 pb-4 no-underline hover:no-underline"
      >
        <Logo size={23} />
        <div className="label">Control plane</div>
      </Link>

      <div className="px-3 pt-3.5 pb-2">
        <div className="label px-2 pb-2">Tenant</div>
        <button
          onClick={() => setOpen((v) => !v)}
          disabled={tenants.length < 2}
          className="flex min-h-[44px] w-full cursor-pointer items-center gap-[9px] rounded-xl border border-line bg-card px-2.5 py-[9px] hover:border-ink-3 disabled:cursor-default disabled:hover:border-line"
        >
          <div
            className="mono flex size-[22px] items-center justify-center rounded-md bg-ink font-semibold text-canvas"
            style={{ fontSize: 11 }}
          >
            {tenantName.slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 truncate text-left text-[14px] font-medium text-ink-2">
            {tenantName}
          </div>
          {tenants.length > 1 ? (
            <Icon name="chevron" size={15} className="text-muted-2" />
          ) : null}
        </button>
        {open && tenants.length > 1 ? (
          <div className="mt-1.5 flex flex-col gap-px rounded-xl border border-line bg-card p-1 shadow-sm">
            {tenants.map((t) => (
              <button
                key={t.slug}
                onClick={() => {
                  onTenant(t.slug);
                  setOpen(false);
                }}
                className="flex cursor-pointer justify-between gap-2 rounded-lg px-[9px] py-2 text-[13.5px] text-ink-3 hover:bg-canvas hover:text-ink"
              >
                <span className="truncate">{t.name}</span>
                <span className="mono text-[11.5px] text-muted-2">
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
            <div className="label px-2 pt-[18px] pb-2">{section.group}</div>
            {section.items.map((item) => (
              <button
                key={item.k}
                onClick={() => onNavigate(item.k)}
                aria-current={isActive(item.k) ? 'page' : undefined}
                className={`flex min-h-[40px] cursor-pointer items-center gap-2.5 rounded-[10px] border px-2.5 py-2 text-[14.5px] font-medium transition-colors ${
                  isActive(item.k)
                    ? 'border-line-soft bg-card text-ink shadow-[0_1px_2px_rgba(21,22,26,0.06)]'
                    : 'border-transparent text-muted hover:bg-canvas hover:text-ink'
                }`}
              >
                <Icon
                  name={item.icon}
                  size={17}
                  className={isActive(item.k) ? 'text-accent' : 'opacity-75'}
                />
                <span className="flex-1 text-left">{item.label}</span>
                {/* Counts are shown only when there is something to count —
                    a badge reading 0 is noise, and one that is always there
                    stops meaning anything. */}
                {item.k === 'approvals' && pendingCount > 0 ? (
                  <span
                    className="rounded-full bg-gate px-2 py-px text-[12px] font-semibold text-white"
                    aria-label={`${pendingCount} waiting for a person`}
                  >
                    {pendingCount}
                  </span>
                ) : null}
                {item.k === 'agents' && agentCount > 0 ? (
                  <span className="mono text-[11.5px] text-muted-2">
                    {agentCount}
                  </span>
                ) : null}
                {item.k === 'tenants' ? (
                  <span
                    className="rounded bg-agent-tint px-1.5 py-px text-[11px] font-semibold text-agent-ink"
                  >
                    SA
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="m-3 flex items-center gap-[9px] rounded-xl border border-line-soft bg-card p-2.5">
        <div className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-ink text-[12px] font-semibold text-canvas">
          {initials(user.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-medium text-ink">
            {user.name}
          </div>
          <div className="truncate text-[12px] text-muted-2">
            {user.role}
          </div>
        </div>
        <button
          onClick={signOut}
          disabled={signingOut}
          title="Sign out"
          aria-label="Sign out"
          className="flex size-[34px] shrink-0 cursor-pointer items-center justify-center rounded-lg border border-line text-muted-2 hover:border-[#F0C9C4] hover:bg-[#F8E0DD] hover:text-danger disabled:cursor-default disabled:opacity-50"
        >
          <Icon name="signout" size={15} />
        </button>
      </div>
    </div>
  );
}
