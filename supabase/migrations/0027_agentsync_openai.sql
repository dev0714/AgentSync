-- OpenAI alongside Claude.
--
--   * GPT models can fill any Low / Medium / High slot of any agent.
--   * The Engineer can run in OpenAI's hosted shell container
--     (engineer_mode 'openai_sandbox'), as the Claude Managed Agent does.
--   * Failover: when a model call fails for a reason on the credential's
--     failover_triggers (rate limit, timeout, 5xx), the step is retried on the
--     other provider — only for projects that opt in
--     (project_ai_configs.fallback_permitted) when the credential requires it.

-- The worker now also loads the tenant's OpenAI credential and the project's
-- AI config (failover opt-in).
create or replace function public.agentsync_worker_task(p_task_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'task', to_jsonb(t),
    'project', to_jsonb(p),
    'repository', (select to_jsonb(r) from agentsync.project_repositories r
                    where r.project_id = p.id order by r.created_at limit 1),
    'runtime', (select to_jsonb(rc) from agentsync.project_runtime_configs rc
                 where rc.project_id = p.id order by rc.created_at limit 1),
    'github', (select to_jsonb(g) from agentsync.github_app_installations g
                where g.tenant_id = t.tenant_id order by g.created_at limit 1),
    'ai', (select to_jsonb(a) from agentsync.ai_provider_credentials a
            where (a.tenant_id = t.tenant_id or a.tenant_id is null)
              and a.provider = 'anthropic'
            order by a.tenant_id nulls last limit 1),
    'ai_openai', (select to_jsonb(a) from agentsync.ai_provider_credentials a
                   where (a.tenant_id = t.tenant_id or a.tenant_id is null)
                     and a.provider = 'openai'
                   order by a.tenant_id nulls last limit 1),
    'project_ai', (select to_jsonb(pa) from agentsync.project_ai_configs pa
                    where pa.project_id = p.id order by pa.created_at limit 1),
    'plan', (select to_jsonb(pl) from agentsync.task_plans pl
              where pl.task_id = t.id order by pl.version desc limit 1),
    'feedback', (select jsonb_agg(jsonb_build_object(
                    'gate', ap.gate, 'decision', ap.decision, 'comments', ap.comments,
                    'decided_at', ap.decided_at) order by ap.decided_at)
                   from agentsync.task_approvals ap
                  where ap.task_id = t.id and ap.decision = 'changes_requested'),
    'month_spend', (select coalesce(sum(u.cost), 0) from agentsync.task_ai_usage u
                     join agentsync.agent_tasks t2 on t2.id = u.task_id
                    where t2.project_id = p.id
                      and u.created_at >= date_trunc('month', now()))
  )
  from agentsync.agent_tasks t
  join agentsync.projects p on p.id = t.project_id
  where t.id = p_task_id;
$$;

-- Usage records say which provider served the call.
drop function if exists public.agentsync_record_ai_usage(uuid, text, text, bigint, bigint, numeric, numeric);

create or replace function public.agentsync_record_ai_usage(
  p_task_id uuid, p_agent_key text, p_model text,
  p_input_tokens bigint, p_output_tokens bigint, p_cost numeric, p_duration_seconds numeric,
  p_provider text default 'anthropic', p_failover boolean default false
)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  insert into agentsync.task_ai_usage (
    tenant_id, task_id, agent_definition_id, provider, model,
    input_tokens, output_tokens, cost, failover, duration_seconds
  )
  select t.tenant_id, t.id,
         (select a.id from agentsync.agent_definitions a
           where a.key = p_agent_key and (a.tenant_id is null or a.tenant_id = t.tenant_id)
           order by a.tenant_id nulls last limit 1),
         p_provider::agentsync.ai_provider, p_model, p_input_tokens, p_output_tokens,
         p_cost, p_failover, p_duration_seconds
    from agentsync.agent_tasks t where t.id = p_task_id;

  update agentsync.agent_tasks
     set input_tokens = coalesce(input_tokens, 0) + p_input_tokens,
         output_tokens = coalesce(output_tokens, 0) + p_output_tokens,
         estimated_cost = coalesce(estimated_cost, 0) + p_cost
   where id = p_task_id;
end;
$$;

-- GPT models are allowed in tier slots.
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
  if p_model !~ '^(claude|gpt|o[0-9])-?[a-z0-9.-]+$' then
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

-- The Engineer can run in OpenAI's hosted container too.
alter table agentsync.projects drop constraint if exists projects_engineer_mode_check;
alter table agentsync.projects add constraint projects_engineer_mode_check
  check (engineer_mode in ('sandbox', 'openai_sandbox', 'direct'));

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
  if p_mode not in ('sandbox', 'openai_sandbox', 'direct') then
    return jsonb_build_object('ok', false, 'error', 'UNKNOWN_MODE');
  end if;
  update agentsync.projects set engineer_mode = p_mode, updated_at = now() where id = p_project_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- A project opts in to failover (project_ai_configs.fallback_permitted).
create or replace function public.agentsync_set_project_failover(
  p_user_id uuid, p_project_id uuid, p_permitted boolean
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_slug text;
  v_tenant uuid;
begin
  select t.slug, t.id into v_slug, v_tenant from agentsync.projects p
    join agentsync.tenants t on t.id = p.tenant_id where p.id = p_project_id;
  if v_slug is null or agentsync.configurable_tenant(p_user_id, v_slug) is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  end if;
  update agentsync.project_ai_configs set fallback_permitted = p_permitted, updated_at = now()
   where project_id = p_project_id;
  if not found then
    -- Models come from the agents' tiers; these columns only describe the default.
    insert into agentsync.project_ai_configs
      (tenant_id, project_id, primary_provider, primary_model, fallback_provider, fallback_permitted)
    values (v_tenant, p_project_id, 'anthropic', 'claude-opus-5-5', 'openai', p_permitted);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Tier settings report each project's failover opt-in, and which providers
-- the tenant has a key for.
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
    ), '{}'::jsonb),
    'failover', coalesce((
      select jsonb_object_agg(p.id, coalesce(pa.fallback_permitted, false))
        from agentsync.projects p
        left join agentsync.project_ai_configs pa on pa.project_id = p.id
       where p.tenant_id = (select id from tenant)
    ), '{}'::jsonb),
    'providers', coalesce((
      select jsonb_agg(distinct a.provider)
        from agentsync.ai_provider_credentials a
       where a.tenant_id = (select id from tenant)
    ), '[]'::jsonb)
  )
  where exists (select 1 from tenant);
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.agentsync_record_ai_usage(uuid, text, text, bigint, bigint, numeric, numeric, text, boolean)',
    'public.agentsync_set_project_failover(uuid, uuid, boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
