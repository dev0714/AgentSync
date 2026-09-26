-- Low / Medium / High: three model slots per agent.
--
-- Every agent has a model and effort for each tier. A request runs at one
-- tier — chosen on the request, defaulting to its project's — and each agent
-- uses its model for that tier. Platform defaults are seeded here; a tenant
-- admin can override any slot for their tenant.

create table agentsync.agent_tier_models (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references agentsync.tenants (id) on delete cascade,
  agent_key text not null,
  tier text not null check (tier in ('low', 'medium', 'high')),
  model text not null,
  effort text check (effort in ('low', 'medium', 'high', 'xhigh', 'max')),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (tenant_id, agent_key, tier)
);

alter table agentsync.agent_tier_models enable row level security;

-- Platform defaults. Effort is null where the model does not take one (Haiku 4.5).
insert into agentsync.agent_tier_models (tenant_id, agent_key, tier, model, effort) values
  (null, 'planner',          'low',    'claude-sonnet-5',  'low'),
  (null, 'planner',          'medium', 'claude-sonnet-5',  'high'),
  (null, 'planner',          'high',   'claude-opus-5-5',  'high'),
  (null, 'engineer',         'low',    'claude-sonnet-5',  'medium'),
  (null, 'engineer',         'medium', 'claude-opus-5-5',  'high'),
  (null, 'engineer',         'high',   'claude-opus-5-5',  'xhigh'),
  (null, 'reviewer',         'low',    'claude-sonnet-5',  'medium'),
  (null, 'reviewer',         'medium', 'claude-opus-5-5',  'medium'),
  (null, 'reviewer',         'high',   'claude-opus-5-5',  'high'),
  (null, 'analyst',          'low',    'claude-sonnet-5',  'medium'),
  (null, 'analyst',          'medium', 'claude-opus-5-5',  'medium'),
  (null, 'analyst',          'high',   'claude-opus-5-5',  'high'),
  (null, 'validator',        'low',    'claude-haiku-4-5', null),
  (null, 'validator',        'medium', 'claude-sonnet-5',  'low'),
  (null, 'validator',        'high',   'claude-sonnet-5',  'medium'),
  (null, 'security_auditor', 'low',    'claude-sonnet-5',  'medium'),
  (null, 'security_auditor', 'medium', 'claude-opus-5-5',  'medium'),
  (null, 'security_auditor', 'high',   'claude-opus-5-5',  'high'),
  (null, 'documenter',       'low',    'claude-haiku-4-5', null),
  (null, 'documenter',       'medium', 'claude-haiku-4-5', null),
  (null, 'documenter',       'high',   'claude-sonnet-5',  'low');

alter table agentsync.projects
  add column if not exists default_tier text not null default 'medium'
    check (default_tier in ('low', 'medium', 'high'));

alter table agentsync.agent_tasks
  add column if not exists tier text check (tier in ('low', 'medium', 'high'));

-- A task without an explicit tier takes its project's default.
create or replace function agentsync.default_task_tier()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.tier is null then
    select default_tier into new.tier from agentsync.projects where id = new.project_id;
  end if;
  return new;
end;
$$;

drop trigger if exists agent_tasks_default_tier on agentsync.agent_tasks;
create trigger agent_tasks_default_tier
  before insert on agentsync.agent_tasks
  for each row execute function agentsync.default_task_tier();

update agentsync.agent_tasks t set tier = p.default_tier
  from agentsync.projects p where p.id = t.project_id and t.tier is null;

/* ---- the worker: which model and effort an agent runs with -------------- */

create or replace function public.agentsync_agent_for(p_task_id uuid, p_key text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select to_jsonb(a)
         || jsonb_build_object(
              'tier', coalesce(t.tier, 'medium'),
              'model', coalesce(m.model, c.primary_model),
              'effort', m.effort)
    from agentsync.agent_tasks t
    join agentsync.agent_definitions a
      on a.key = p_key
     and (a.tenant_id is null or a.tenant_id = t.tenant_id)
     and (a.project_id is null or a.project_id = t.project_id)
    left join agentsync.agent_ai_configs c on c.agent_definition_id = a.id
    left join lateral (
      select tm.model, tm.effort
        from agentsync.agent_tier_models tm
       where tm.agent_key = p_key
         and tm.tier = coalesce(t.tier, 'medium')
         and (tm.tenant_id is null or tm.tenant_id = t.tenant_id)
       order by tm.tenant_id nulls last
       limit 1
    ) m on true
   where t.id = p_task_id
   order by a.project_id nulls last, a.tenant_id nulls last
   limit 1;
$$;

/* ---- portal reads and writes ------------------------------------------- */

-- Every agent's three slots for a tenant (override or platform default), and
-- each project's default tier.
create or replace function public.agentsync_tier_settings(p_user_id uuid, p_tenant_slug text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with tenant as (
    select t.id from agentsync.tenants t
     where t.slug = p_tenant_slug
       and (exists (select 1 from agentsync.users u where u.id = p_user_id and u.state = 'ACTIVE' and u.role = 'SUPER_ADMIN')
            or exists (select 1 from agentsync.tenant_users tu
                        where tu.tenant_id = t.id and tu.user_id = p_user_id and tu.state = 'ACTIVE'))
  )
  select jsonb_build_object(
    'can_edit', agentsync.configurable_tenant(p_user_id, p_tenant_slug) is not null,
    'slots', coalesce((
      select jsonb_agg(jsonb_build_object(
               'agent_key', d.agent_key, 'tier', d.tier,
               'model', coalesce(o.model, d.model),
               'effort', case when o.id is not null then o.effort else d.effort end,
               'overridden', o.id is not null)
             order by d.agent_key, array_position(array['low','medium','high'], d.tier))
        from agentsync.agent_tier_models d
        left join agentsync.agent_tier_models o
          on o.tenant_id = (select id from tenant) and o.agent_key = d.agent_key and o.tier = d.tier
       where d.tenant_id is null
    ), '[]'::jsonb),
    'projects', coalesce((
      select jsonb_object_agg(p.id, p.default_tier)
        from agentsync.projects p where p.tenant_id = (select id from tenant)
    ), '{}'::jsonb)
  )
  where exists (select 1 from tenant);
$$;

create or replace function public.agentsync_set_tier_model(
  p_user_id uuid, p_tenant_slug text, p_agent_key text, p_tier text,
  p_model text, p_effort text default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  v_tenant := agentsync.configurable_tenant(p_user_id, p_tenant_slug);
  if v_tenant is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  end if;
  if p_tier not in ('low', 'medium', 'high') then
    return jsonb_build_object('ok', false, 'error', 'UNKNOWN_TIER');
  end if;
  if p_model !~ '^claude-[a-z0-9-]+$' then
    return jsonb_build_object('ok', false, 'error', 'UNKNOWN_MODEL');
  end if;
  if not exists (select 1 from agentsync.agent_tier_models
                  where tenant_id is null and agent_key = p_agent_key) then
    return jsonb_build_object('ok', false, 'error', 'UNKNOWN_AGENT');
  end if;

  insert into agentsync.agent_tier_models (tenant_id, agent_key, tier, model, effort)
  values (v_tenant, p_agent_key, p_tier, p_model,
          case when p_model like 'claude-haiku-4-5%' then null else nullif(p_effort, '') end)
  on conflict (tenant_id, agent_key, tier) do update
    set model = excluded.model, effort = excluded.effort, updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

-- Back to the platform default for one slot.
create or replace function public.agentsync_reset_tier_model(
  p_user_id uuid, p_tenant_slug text, p_agent_key text, p_tier text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  v_tenant := agentsync.configurable_tenant(p_user_id, p_tenant_slug);
  if v_tenant is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  end if;
  delete from agentsync.agent_tier_models
   where tenant_id = v_tenant and agent_key = p_agent_key and tier = p_tier;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.agentsync_set_project_tier(
  p_user_id uuid, p_project_id uuid, p_tier text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_slug text;
begin
  select t.slug into v_slug from agentsync.projects p
    join agentsync.tenants t on t.id = p.tenant_id where p.id = p_project_id;
  if v_slug is null or agentsync.configurable_tenant(p_user_id, v_slug) is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  end if;
  if p_tier not in ('low', 'medium', 'high') then
    return jsonb_build_object('ok', false, 'error', 'UNKNOWN_TIER');
  end if;
  update agentsync.projects set default_tier = p_tier, updated_at = now() where id = p_project_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- Portal submissions carry an optional tier; the trigger fills the project
-- default when it is null.
drop function if exists public.agentsync_portal_submit_task(uuid, uuid, text, text, text, text, text[]);

create or replace function public.agentsync_portal_submit_task(
  p_user_id uuid,
  p_project_id uuid,
  p_title text,
  p_description text default null,
  p_request_type text default 'code_change',
  p_priority text default 'normal',
  p_acceptance_criteria text[] default '{}',
  p_tier text default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_user agentsync.users;
  v_project agentsync.projects;
  v_role agentsync.user_role;
  v_row record;
begin
  select * into v_user from agentsync.users where id = p_user_id and state = 'ACTIVE';
  select * into v_project from agentsync.projects where id = p_project_id;
  if v_user.id is null or v_project.id is null then
    return jsonb_build_object('ok', false, 'error', case when v_user.id is null
      then 'NOT_AUTHORISED' else 'PROJECT_NOT_FOUND' end);
  end if;

  select tu.role into v_role from agentsync.tenant_users tu
   where tu.tenant_id = v_project.tenant_id and tu.user_id = p_user_id and tu.state = 'ACTIVE';

  if not (v_user.role = 'SUPER_ADMIN'
          or coalesce(v_role, 'VIEWER') in
             ('SUPER_ADMIN', 'TENANT_ADMIN', 'PROJECT_MANAGER', 'DEVELOPER', 'APPROVER')) then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  end if;
  if not v_project.enabled then
    return jsonb_build_object('ok', false, 'error', 'PROJECT_DISABLED');
  end if;
  if p_tier is not null and p_tier not in ('low', 'medium', 'high') then
    return jsonb_build_object('ok', false, 'error', 'UNKNOWN_TIER');
  end if;

  select * into v_row from agentsync.submit_task(
    v_project.tenant_id, v_project.id, null,
    'portal:' || gen_random_uuid()::text,
    p_title, nullif(trim(coalesce(p_description, '')), ''), null,
    p_request_type::agentsync.request_type, p_priority::agentsync.task_priority,
    coalesce(p_acceptance_criteria, '{}'),
    jsonb_build_object('id', v_user.id, 'name', v_user.display_name,
                       'email', v_user.email, 'via', 'portal'),
    null
  );

  if p_tier is not null then
    update agentsync.agent_tasks set tier = p_tier where id = v_row.task_id;
  end if;

  return jsonb_build_object('ok', true, 'task_id', v_row.task_id,
                            'correlation_id', v_row.correlation_id, 'status', v_row.status);
end;
$$;

-- API submissions may name a tier too.
create or replace function public.agentsync_set_task_tier(p_task_id uuid, p_tier text)
returns void
language sql security definer set search_path = ''
as $$
  update agentsync.agent_tasks set tier = p_tier
   where id = p_task_id and p_tier in ('low', 'medium', 'high');
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.agentsync_tier_settings(uuid, text)',
    'public.agentsync_set_tier_model(uuid, text, text, text, text, text)',
    'public.agentsync_reset_tier_model(uuid, text, text, text)',
    'public.agentsync_set_project_tier(uuid, uuid, text)',
    'public.agentsync_portal_submit_task(uuid, uuid, text, text, text, text, text[], text)',
    'public.agentsync_set_task_tier(uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
