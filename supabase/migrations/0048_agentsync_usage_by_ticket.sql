-- Usage and cost, per ticket and per project: the screen's detail can be
-- narrowed to one project, and lists what each ticket cost this month (by
-- agent) and in all.

drop function if exists public.agentsync_portal_usage_detail(uuid, text);

create or replace function public.agentsync_portal_usage_detail(
  p_user_id uuid, p_tenant_slug text, p_project_id uuid default null
)
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
  if p_project_id is not null and not exists (
    select 1 from agentsync.projects p where p.id = p_project_id and p.tenant_id = v_tenant
  ) then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  end if;

  return (
    with u as (
      select u.*, t.project_id, lower(coalesce(ad.key, ad.display_name, 'other')) as agent_key,
             coalesce(ad.display_name, 'Other') as agent_name
        from agentsync.task_ai_usage u
        join agentsync.agent_tasks t on t.id = u.task_id
        left join agentsync.agent_definitions ad on ad.id = u.agent_definition_id
       where u.tenant_id = v_tenant
         and (p_project_id is null or t.project_id = p_project_id)
    ), m as (
      select * from u where u.created_at >= v_from
    )
    select jsonb_build_object(
      'ok', true,
      'month_start', v_from,
      'project_id', p_project_id,
      'totals', (
        select jsonb_build_object(
          'cost', coalesce(sum(m.cost), 0),
          'input_tokens', coalesce(sum(m.input_tokens), 0),
          'output_tokens', coalesce(sum(m.output_tokens), 0),
          'failover_calls', count(*) filter (where m.failover))
          from m),
      'days', coalesce((
        select jsonb_agg(jsonb_build_object('day', d.day, 'anthropic', d.anthropic, 'openai', d.openai) order by d.day)
          from (
            select g.day::date as day,
                   coalesce(sum(m.cost) filter (where m.provider::text = 'anthropic'), 0) as anthropic,
                   coalesce(sum(m.cost) filter (where m.provider::text <> 'anthropic'), 0) as openai
              from generate_series(v_from, date_trunc('day', now()), interval '1 day') g(day)
              left join m on m.created_at >= g.day and m.created_at < g.day + interval '1 day'
             group by g.day
          ) d), '[]'::jsonb),
      'agents', coalesce((
        select jsonb_agg(to_jsonb(a) order by a.cost desc)
          from (
            select m.agent_name as name,
                   (array_agg(m.model order by m.created_at desc))[1] as model,
                   sum(m.input_tokens + m.output_tokens) as tokens,
                   sum(m.cost) as cost
              from m group by m.agent_name
          ) a), '[]'::jsonb),
      'projects', coalesce((
        select jsonb_agg(to_jsonb(p) order by p.cost desc)
          from (
            select pr.id, pr.name, count(distinct m.task_id) as tasks, sum(m.cost) as cost
              from m join agentsync.projects pr on pr.id = m.project_id
             group by pr.id, pr.name
          ) p), '[]'::jsonb),
      'tickets', coalesce((
        select jsonb_agg(to_jsonb(k) order by k.last_at desc)
          from (
            select t.id as task_id,
                   coalesce(nullif(t.external_reference, ''), left(t.correlation_id::text, 8)) as reference,
                   t.title,
                   t.status::text as status,
                   pr.name as project,
                   sum(m.cost) filter (where m.agent_key like 'planner%') as planner,
                   sum(m.cost) filter (where m.agent_key like 'engineer%') as engineer,
                   sum(m.cost) filter (where m.agent_key like 'reviewer%') as reviewer,
                   sum(m.cost) filter (where m.agent_key not like 'planner%' and m.agent_key not like 'engineer%' and m.agent_key not like 'reviewer%') as other,
                   sum(m.input_tokens + m.output_tokens) as tokens,
                   sum(m.cost) as cost,
                   (select sum(a.cost) from agentsync.task_ai_usage a where a.task_id = t.id) as total_cost,
                   max(m.created_at) as last_at
              from m
              join agentsync.agent_tasks t on t.id = m.task_id
              join agentsync.projects pr on pr.id = t.project_id
             group by t.id, pr.name
             order by max(m.created_at) desc
             limit 200
          ) k), '[]'::jsonb),
      'project_options', coalesce((
        select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) order by lower(p.name))
          from agentsync.projects p where p.tenant_id = v_tenant), '[]'::jsonb),
      'finished_tasks', (
        select count(*) from agentsync.agent_tasks t
         where t.tenant_id = v_tenant and t.status::text = 'completed' and t.completed_at >= v_from
           and (p_project_id is null or t.project_id = p_project_id))
    )
  );
end;
$$;
revoke all on function public.agentsync_portal_usage_detail(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.agentsync_portal_usage_detail(uuid, text, uuid) to service_role;
