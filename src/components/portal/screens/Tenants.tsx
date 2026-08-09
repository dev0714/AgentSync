'use client';

import { DANGER_ACTIONS, ROLE_OPTIONS, TENANTS } from '@/data/portal';
import { ColLabel, FieldRows, Pill, Tabs, useRoleField } from '../ui';

function UserRow({
  tenantSlug,
  index,
  user,
}: {
  tenantSlug: string;
  index: number;
  user: { name: string; email: string; role: string; active: string; state: string };
}) {
  const [role, setRole] = useRoleField(
    `tenant.${tenantSlug}.user.${index}`,
    user.role,
  );

  const stateColor: [string, string] =
    user.state === 'ACTIVE'
      ? ['#122E1E', '#6FD69C']
      : user.state === 'SERVICE'
        ? ['#132430', '#7FB6E0']
        : ['#33240F', '#F5A623'];

  return (
    <div className="grid min-w-[720px] grid-cols-[minmax(220px,1fr)_190px_140px_100px] items-center gap-3 border-b border-line-faint px-4 py-2.5">
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium">{user.name}</div>
        <div className="mono truncate text-[10.5px] text-muted-2">
          {user.email}
        </div>
      </div>
      <select
        className="field-select"
        value={role}
        onChange={(e) => setRole(e.target.value)}
        aria-label={`Role for ${user.name}`}
      >
        {ROLE_OPTIONS.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <span className="text-[11.5px] text-muted">{user.active}</span>
      <div className="text-right">
        <Pill c={stateColor}>{user.state}</Pill>
      </div>
    </div>
  );
}

export default function Tenants({
  selected,
  onSelect,
  group,
  onGroup,
}: {
  selected: string;
  onSelect: (slug: string) => void;
  group: number;
  onGroup: (i: number) => void;
}) {
  const tenant = TENANTS.find((t) => t.slug === selected) ?? TENANTS[0];
  const groups = [
    ...tenant.groups.map((g) => ({ ...g, kind: 'form' as const })),
    { title: 'Users & roles', kind: 'users' as const, table: '', rows: [] },
    { title: 'Danger zone', kind: 'danger' as const, table: '', rows: [] },
  ];
  const g = groups[Math.min(group, groups.length - 1)];

  return (
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[268px_1fr]">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="label flex-1">ALL TENANTS</div>
          <button className="mono cursor-pointer text-[10.5px] text-accent">
            + New tenant
          </button>
        </div>
        {TENANTS.map((t) => (
          <button
            key={t.slug}
            onClick={() => {
              onSelect(t.slug);
              onGroup(0);
            }}
            className="cursor-pointer rounded-lg border p-3 text-left"
            style={{
              background: selected === t.slug ? '#1A1A1D' : '#141416',
              borderColor: selected === t.slug ? '#3A3A40' : '#242428',
            }}
          >
            <div className="flex items-center gap-2">
              <span
                className="size-1.5 rounded-full"
                style={{
                  background: t.status === 'active' ? '#4ADE80' : '#F5A623',
                }}
              />
              <span className="flex-1 text-[13px] font-semibold">{t.name}</span>
              <span className="mono text-[9.5px] text-muted-2">{t.plan}</span>
            </div>
            <div className="mono mt-1 text-[10px] text-muted-3">{t.slug}</div>
            <div className="mt-1 text-[11.5px] text-muted">{t.listMeta}</div>
          </button>
        ))}
      </div>

      <div className="card min-w-0 overflow-hidden">
        <div className="flex flex-col items-start gap-4 p-4 lg:flex-row lg:items-center">
          <div className="min-w-0 flex-1">
            <div className="mb-1.5 flex flex-wrap items-center gap-2.5">
              <span className="mono text-[11px] text-accent">{tenant.slug}</span>
              <Pill
                c={
                  tenant.status === 'active'
                    ? ['#122E1E', '#6FD69C']
                    : ['#33240F', '#F5A623']
                }
              >
                {tenant.status.toUpperCase()}
              </Pill>
              <span className="mono text-[10.5px] text-muted-2">
                {tenant.meta}
              </span>
            </div>
            <div className="text-[18px] font-semibold tracking-[-0.02em]">
              {tenant.name}
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn">Impersonate</button>
            <button className="btn-primary">Save changes</button>
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
              <div className="text-[13px] font-semibold">{g.title}</div>
              <div className="mono text-[10px] text-muted-2">{g.table}</div>
            </div>
            <FieldRows
              prefix={`tenant.${tenant.slug}.${g.title}`}
              rows={g.rows}
            />
          </div>
        ) : null}

        {g.kind === 'users' ? (
          <div className="overflow-x-auto">
            <div className="grid min-w-[720px] grid-cols-[minmax(220px,1fr)_190px_140px_100px] gap-3 border-b border-line bg-raised px-4 py-[9px]">
              <ColLabel>USER</ColLabel>
              <ColLabel>ROLE</ColLabel>
              <ColLabel>LAST ACTIVE</ColLabel>
              <ColLabel right>STATE</ColLabel>
            </div>
            {tenant.users.map((u, i) => (
              <UserRow
                key={u.email}
                tenantSlug={tenant.slug}
                index={i}
                user={u}
              />
            ))}
          </div>
        ) : null}

        {g.kind === 'danger' ? (
          <div className="flex flex-col gap-2 p-4">
            {DANGER_ACTIONS.map((da) => (
              <div
                key={da.title}
                className="flex flex-col items-start gap-3 rounded-lg border p-3.5 lg:flex-row lg:items-center"
                style={{ borderColor: '#452020', background: '#1A0F0E' }}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-danger">
                    {da.title}
                  </div>
                  <div
                    className="mt-1 text-[12px] text-muted"
                    style={{ lineHeight: 1.55 }}
                  >
                    {da.text}
                  </div>
                </div>
                <button className="btn-danger shrink-0">{da.action}</button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
