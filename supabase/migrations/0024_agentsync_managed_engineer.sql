-- The Engineer can run as a Claude Managed Agent: a sandbox with the
-- repository cloned in, where it edits, runs the project's own checks, fixes
-- what fails, and pushes the branch. The Planner and Reviewer stay as direct
-- model calls.
--
-- One Managed Agent and one environment exist per Anthropic credential (the
-- platform key or a tenant's own), created on first use and updated in place
-- when the Engineer's prompt changes — never re-created per task.

create table agentsync.managed_agent_setup (
  credential_key text primary key,
  agent_id text not null,
  agent_version integer not null,
  environment_id text not null,
  prompt_hash text not null,
  updated_at timestamptz not null default now()
);
alter table agentsync.managed_agent_setup enable row level security;

alter table agentsync.projects
  add column if not exists engineer_mode text not null default 'sandbox'
    check (engineer_mode in ('sandbox', 'direct'));

create or replace function public.agentsync_managed_setup_get(p_credential_key text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select to_jsonb(s) from agentsync.managed_agent_setup s where s.credential_key = p_credential_key;
$$;

create or replace function public.agentsync_managed_setup_put(
  p_credential_key text, p_agent_id text, p_agent_version integer,
  p_environment_id text, p_prompt_hash text
)
returns void
language sql security definer set search_path = ''
as $$
  insert into agentsync.managed_agent_setup (credential_key, agent_id, agent_version, environment_id, prompt_hash)
  values (p_credential_key, p_agent_id, p_agent_version, p_environment_id, p_prompt_hash)
  on conflict (credential_key) do update
    set agent_id = excluded.agent_id, agent_version = excluded.agent_version,
        environment_id = excluded.environment_id, prompt_hash = excluded.prompt_hash,
        updated_at = now();
$$;

create or replace function public.agentsync_set_project_engineer_mode(
  p_user_id uuid, p_project_id uuid, p_mode text
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
  if p_mode not in ('sandbox', 'direct') then
    return jsonb_build_object('ok', false, 'error', 'UNKNOWN_MODE');
  end if;
  update agentsync.projects set engineer_mode = p_mode, updated_at = now() where id = p_project_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- Tier settings now also report each project's Engineer mode.
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
    ), '{}'::jsonb),
    'engineer_modes', coalesce((
      select jsonb_object_agg(p.id, p.engineer_mode)
        from agentsync.projects p where p.tenant_id = (select id from tenant)
    ), '{}'::jsonb)
  )
  where exists (select 1 from tenant);
$$;

revoke all on function public.agentsync_managed_setup_get(text) from public, anon, authenticated;
revoke all on function public.agentsync_managed_setup_put(text, text, integer, text, text) from public, anon, authenticated;
revoke all on function public.agentsync_set_project_engineer_mode(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.agentsync_managed_setup_get(text) to service_role;
grant execute on function public.agentsync_managed_setup_put(text, text, integer, text, text) to service_role;
grant execute on function public.agentsync_set_project_engineer_mode(uuid, uuid, text) to service_role;
