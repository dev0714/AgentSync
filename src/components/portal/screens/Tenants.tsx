'use client';

import type { Member, Tenant, TenantSummary } from '@/lib/portal-data';
import { STATE_COLOUR, rowsFrom, statusLabel, swatch } from '@/lib/portal-ui';
import { Ago, ColLabel, Empty, FieldRows, Pill, Tabs } from '../ui';

export default function Tenants({
  tenants,
  tenant,
  members,
  onSelect,
  group,
  onGroup,
}: {
  tenants: TenantSummary[];
  tenant: Tenant | null;
  members: Member[];
  onSelect: (slug: string) => void;
  group: number;
  onGroup: (i: number) => void;
}) {
  if (!tenant) {
    return (
      <Empty
        title="No tenant"
        detail="This account is not a member of any tenant yet. A tenant owns projects, source systems, connections and members; everything else hangs off one."
        table="agentsync.tenants · tenant_users"
      />
    );
  }

  const groups = [
    {
      title: 'Identity',
      table: 'tenants',
      kind: 'form' as const,
      rows: rowsFrom({
        slug: tenant.slug,
        name: tenant.name,
        plan: tenant.plan,
        status: tenant.status,
        primary_contact: tenant.primary_contact,
        billing_email: tenant.billing_email,
        data_region: tenant.data_region,
        notes: tenant.notes,
      }),
    },
    {
      title: 'Settings',
      table: 'tenants.settings',
      kind: 'form' as const,
      rows: rowsFrom(tenant.settings),
      missing:
        'No tenant settings are stored, so platform defaults apply — including the concurrency cap the queue enforces.',
    },
    { title: 'Users & roles', table: 'tenant_users', kind: 'users' as const, rows: [] },
  ];
  const g = groups[Math.min(group, groups.length - 1)];

  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-[14px] text-muted-3">Every organisation on this AgentSync. Pick one to see its settings and people.</p>
      <section aria-label="All tenants" className="card overflow-x-auto">
        <div className="grid min-w-[760px] grid-cols-[minmax(0,1fr)_100px_100px_110px_120px] gap-4 border-b border-line-soft bg-raised px-5 py-[9px]">
          <ColLabel>Tenant</ColLabel>
          <ColLabel>Plan</ColLabel>
          <ColLabel>Projects</ColLabel>
          <ColLabel>Tasks</ColLabel>
          <ColLabel>State</ColLabel>
        </div>
        {tenants.map((t) => {
          const on = tenant.slug === t.slug;
          const active = t.status.toLowerCase() === 'active';
          return (
            <button
              key={t.slug}
              type="button"
              aria-current={on ? 'true' : undefined}
              onClick={() => {
                onSelect(t.slug);
                onGroup(0);
              }}
              className={`grid w-full min-w-[760px] cursor-pointer grid-cols-[minmax(0,1fr)_100px_100px_110px_120px] items-center gap-4 border-b border-line-faint px-5 py-3 text-left last:border-0 ${
                on ? 'bg-raised shadow-[inset_3px_0_0_var(--color-ink)]' : 'hover:bg-raised'
              }`}
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[14px] font-semibold">{t.name}</span>
                <span className="mono truncate text-[12px] text-muted-3">{t.slug}</span>
              </span>
              <span className="text-[13px] text-ink-3">{t.plan ? statusLabel(t.plan) : '—'}</span>
              <span className="text-[13px] tabular-nums">{t.project_count}</span>
              <span className="text-[13px] tabular-nums">{t.task_count}</span>
              <span>
                <Pill c={active ? ['var(--color-ok-tint)', 'var(--color-ok-ink)'] : ['var(--color-caution-tint)', 'var(--color-caution-ink)']}>
                  {statusLabel(t.status)}
                </Pill>
              </span>
            </button>
          );
        })}
      </section>

      <div className="card min-w-0 overflow-hidden">
        <div className="flex flex-col items-start gap-4 p-4 lg:flex-row lg:items-center">
          <div className="min-w-0 flex-1">
            <div className="mb-1.5 flex flex-wrap items-center gap-2.5">
              <span className="mono text-[12.5px] text-muted-3">{tenant.slug}</span>
              <Pill
                c={
                  tenant.status.toLowerCase() === 'active'
                    ? ['var(--color-ok-tint)', 'var(--color-ok-ink)']
                    : ['var(--color-caution-tint)', 'var(--color-caution-ink)']
                }
              >
                {statusLabel(tenant.status)}
              </Pill>
              <span className="mono text-[12px] text-muted-2">
                {tenant.plan ?? 'no plan'} · {tenant.data_region ?? 'no region'}
              </span>
            </div>
            <div className="text-[20px] font-semibold tracking-[-0.02em]">
              {tenant.name}
            </div>
          </div>
        </div>

        <div className="card-head">
          <Tabs
            tabs={groups.map((gr, i) => ({ k: String(i), label: gr.title }))}
            active={String(Math.min(group, groups.length - 1))}
            onSelect={(k) => onGroup(Number(k))}
          />
        </div>

        {g.kind === 'form' ? (
          <div className="p-4">
            <div className="mb-3 flex items-center gap-2.5">
              <div className="text-[14.5px] font-semibold">{g.title}</div>
              <div className="mono text-[11.5px] text-muted-2">{g.table}</div>
            </div>
            {g.rows.length === 0 ? (
              <div className="text-[14px] text-muted" style={{ lineHeight: 1.6 }}>
                {g.missing ?? 'Nothing configured.'}
              </div>
            ) : (
              <FieldRows prefix={`tenant.${tenant.slug}.${g.title}`} rows={g.rows} />
            )}
          </div>
        ) : null}

        {g.kind === 'users' ? (
          <div className="overflow-x-auto">
            <div className="grid min-w-[720px] grid-cols-[minmax(220px,1fr)_190px_140px_100px] gap-3 border-b border-line bg-raised px-4 py-[9px]">
              <ColLabel>User</ColLabel>
              <ColLabel>Role</ColLabel>
              <ColLabel>Last active</ColLabel>
              <ColLabel right>State</ColLabel>
            </div>
            {members.map((u) => (
              <div
                key={u.email ?? u.display_name ?? ''}
                className="grid min-w-[720px] grid-cols-[minmax(220px,1fr)_190px_140px_100px] items-center gap-3 border-b border-line-faint px-4 py-2.5"
              >
                <div className="min-w-0">
                  <div className="truncate text-[14.5px] font-medium">
                    {u.display_name ?? '—'}
                  </div>
                  <div className="mono truncate text-[12px] text-muted-2">
                    {u.email ?? '—'}
                  </div>
                </div>
                <span className="mono text-[13px] text-ink-3">{u.role}</span>
                <span className="text-[13px] text-muted">
                  <Ago iso={u.last_active_at} />
                </span>
                <div className="text-right">
                  <Pill c={swatch(STATE_COLOUR, u.state)}>{u.state}</Pill>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
