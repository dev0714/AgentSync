'use client';

import type { Member, Tenant, TenantSummary } from '@/lib/portal-data';
import { STATE_COLOUR, rowsFrom, swatch } from '@/lib/portal-ui';
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
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[268px_1fr]">
      <div className="flex flex-col gap-2">
        <div className="label">All tenants</div>
        {tenants.map((t) => (
          <button
            key={t.slug}
            onClick={() => {
              onSelect(t.slug);
              onGroup(0);
            }}
            className="cursor-pointer rounded-lg border p-3 text-left"
            style={{
              background: tenant.slug === t.slug ? 'var(--color-raised)' : 'var(--color-card)',
              borderColor: tenant.slug === t.slug ? 'var(--color-line-strong)' : 'var(--color-line)',
            }}
          >
            <div className="flex items-center gap-2">
              <span
                className="size-1.5 rounded-full"
                style={{
                  background: t.status.toLowerCase() === 'active' ? 'var(--color-ok)' : 'var(--color-muted-4)',
                }}
              />
              <span className="flex-1 text-[14.5px] font-semibold">{t.name}</span>
              <span className="mono text-[11.5px] text-muted-2">{t.plan}</span>
            </div>
            <div className="mono mt-1 text-[11.5px] text-muted-3">{t.slug}</div>
            <div className="mt-1 text-[13px] text-muted">
              {t.project_count} project{t.project_count === 1 ? '' : 's'} ·{' '}
              {t.task_count} task{t.task_count === 1 ? '' : 's'}
            </div>
          </button>
        ))}
      </div>

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
                {tenant.status.toUpperCase()}
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
