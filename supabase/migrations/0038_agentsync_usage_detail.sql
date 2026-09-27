-- The Usage and cost screen: this month's spend by day (per provider), by
-- agent and by project. Readable by anyone who belongs to the tenant.

create or replace function agentsync.readable_tenant(p_user_id uuid, p_tenant_slug text)
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_platform_role agentsync.user_role;
begin
  select u.role into v_platform_role from agentsync.users u where u.id = p_user_id and u.state = 'ACTIVE';
  if v_platform_role is null then return null; end if;
  select t.id into v_tenant from agentsync.tenants t where t.slug = p_tenant_slug;
  if v_tenant is null then return null; end if;
  if v_platform_role = 'SUPER_ADMIN' then return v_tenant; end if;
  if exists (select 1 from agentsync.tenant_users tu
              where tu.tenant_id = v_tenant and tu.user_id = p_user_id and tu.state = 'ACTIVE') then
    return v_tenant;
  end if;
  return null;
end;
$$;

revoke all on function agentsync.readable_tenant(uuid, text) from public, anon, authenticated;

create or replace function public.agentsync_portal_usage_detail(p_user_id uuid, p_tenant_slug text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_tenant uuid := agentsync.readable_tenant(p_user_id, p_tenant_slug);
  v_from timestamptz := date_trunc('month', now());
begin
  if v_tenant is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  end if;
  return jsonb_build_object(
    'ok', true,
    'month_start', v_from,
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'anthropic', d.anthropic, 'openai', d.openai) order by d.day)
        from (
          select g.day::date as day,
                 coalesce(sum(u.cost) filter (where u.provider::text = 'anthropic'), 0) as anthropic,
                 coalesce(sum(u.cost) filter (where u.provider::text <> 'anthropic'), 0) as openai
            from generate_series(v_from, date_trunc('day', now()), interval '1 day') g(day)
            left join agentsync.task_ai_usage u
              on u.tenant_id = v_tenant and u.created_at >= g.day and u.created_at < g.day + interval '1 day'
           group by g.day
        ) d), '[]'::jsonb),
    'agents', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.cost desc)
        from (
          select coalesce(ad.display_name, 'Other') as name,
                 (array_agg(u.model order by u.created_at desc))[1] as model,
                 sum(u.input_tokens + u.output_tokens) as tokens,
                 sum(u.cost) as cost
            from agentsync.task_ai_usage u
            left join agentsync.agent_definitions ad on ad.id = u.agent_definition_id
           where u.tenant_id = v_tenant and u.created_at >= v_from
           group by coalesce(ad.display_name, 'Other')
        ) a), '[]'::jsonb),
    'projects', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.cost desc)
        from (
          select pr.name, count(distinct u.task_id) as tasks, sum(u.cost) as cost
            from agentsync.task_ai_usage u
            join agentsync.agent_tasks t on t.id = u.task_id
            join agentsync.projects pr on pr.id = t.project_id
           where u.tenant_id = v_tenant and u.created_at >= v_from
           group by pr.name
        ) p), '[]'::jsonb),
    'finished_tasks', (
      select count(*) from agentsync.agent_tasks t
       where t.tenant_id = v_tenant and t.status::text = 'completed' and t.completed_at >= v_from)
  );
end;
$$;

revoke all on function public.agentsync_portal_usage_detail(uuid, text) from public, anon, authenticated;
grant execute on function public.agentsync_portal_usage_detail(uuid, text) to service_role;
