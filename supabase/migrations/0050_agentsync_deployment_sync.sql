-- Deployments, read from the provider: AgentSync asks Vercel for the
-- tenant's recent deployments and keeps the ones built from a connected
-- repository, matched to their project and — by commit or branch — to the
-- task that produced them.

alter table agentsync.deployment_providers
  add column if not exists last_synced_at timestamptz,
  add column if not exists last_sync_error text;

-- What the sync needs: the provider's token reference and team, and whether
-- it ran recently (the screen asks at most once a minute).
create or replace function public.agentsync_deployment_sync_config(p_user_id uuid, p_tenant_slug text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_tenant uuid := agentsync.readable_tenant(p_user_id, p_tenant_slug);
  v_p agentsync.deployment_providers;
begin
  if v_tenant is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  end if;
  select * into v_p from agentsync.deployment_providers where tenant_id = v_tenant limit 1;
  return jsonb_build_object(
    'ok', true,
    'tenant_id', v_tenant,
    'connected', v_p.id is not null,
    'provider', v_p.provider,
    'team_id', v_p.team_id,
    'token_reference', v_p.api_token_reference,
    'last_synced_at', v_p.last_synced_at,
    'last_sync_error', v_p.last_sync_error,
    'repositories', coalesce((
      select jsonb_agg(lower(r.github_owner || '/' || r.repository))
        from agentsync.project_repositories r
        join agentsync.projects p on p.id = r.project_id
       where p.tenant_id = v_tenant), '[]'::jsonb));
end;
$$;

-- Records what the provider reported. Each row names its repository, commit
-- and branch; rows from repositories no project uses are skipped.
create or replace function public.agentsync_deployments_record(p_tenant_id uuid, p_rows jsonb, p_error text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_row jsonb;
  v_project uuid;
  v_task uuid;
  v_kept integer := 0;
begin
  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    select r.project_id into v_project
      from agentsync.project_repositories r
      join agentsync.projects p on p.id = r.project_id
     where p.tenant_id = p_tenant_id
       and lower(r.github_owner) = lower(v_row->>'org')
       and lower(r.repository) = lower(v_row->>'repo')
     limit 1;
    continue when v_project is null;

    select t.id into v_task
      from agentsync.agent_tasks t
     where t.project_id = v_project
       and ((v_row->>'sha' is not null and t.commit_sha = v_row->>'sha')
            or (v_row->>'ref' is not null and t.branch_name = v_row->>'ref'))
     order by (t.commit_sha = v_row->>'sha') desc nulls last, t.updated_at desc
     limit 1;

    insert into agentsync.deployments as d (
      tenant_id, project_id, task_id, provider, external_id, environment, url, branch, commit_sha,
      status, build_duration_seconds, started_at, finished_at)
    values (
      p_tenant_id, v_project, v_task, coalesce(v_row->>'provider', 'vercel'), v_row->>'external_id',
      (v_row->>'environment')::agentsync.deployment_env, v_row->>'url', v_row->>'ref', v_row->>'sha',
      (v_row->>'status')::agentsync.deployment_status, (v_row->>'build_seconds')::numeric,
      coalesce((v_row->>'started_at')::timestamptz, now()), (v_row->>'finished_at')::timestamptz)
    on conflict (provider, external_id) do update set
      task_id = coalesce(excluded.task_id, d.task_id),
      environment = excluded.environment,
      url = excluded.url,
      status = excluded.status,
      build_duration_seconds = excluded.build_duration_seconds,
      finished_at = excluded.finished_at;
    v_kept := v_kept + 1;
  end loop;

  update agentsync.deployment_providers
     set last_synced_at = now(), last_sync_error = left(p_error, 1000)
   where tenant_id = p_tenant_id;
  return jsonb_build_object('ok', true, 'kept', v_kept);
end;
$$;

-- The Deployments screen: newest first, with the project and task behind each.
create or replace function public.agentsync_portal_deployments(p_user_id uuid, p_tenant_slug text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_tenant uuid := agentsync.readable_tenant(p_user_id, p_tenant_slug);
begin
  if v_tenant is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  end if;
  return jsonb_build_object(
    'ok', true,
    'deployments', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.started_at desc)
        from (
          select dp.id, dp.environment::text as environment, dp.url, dp.branch, dp.commit_sha,
                 dp.status::text as status, dp.provider, dp.build_duration_seconds, dp.started_at, dp.finished_at,
                 pr.name as project, dp.task_id, tk.title as task_title
            from agentsync.deployments dp
            join agentsync.projects pr on pr.id = dp.project_id
            left join agentsync.agent_tasks tk on tk.id = dp.task_id
           where dp.tenant_id = v_tenant
           order by dp.started_at desc
           limit 200
        ) x), '[]'::jsonb));
end;
$$;

revoke all on function public.agentsync_deployment_sync_config(uuid, text) from public, anon, authenticated;
revoke all on function public.agentsync_deployments_record(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.agentsync_portal_deployments(uuid, text) from public, anon, authenticated;
grant execute on function public.agentsync_deployment_sync_config(uuid, text) to service_role;
grant execute on function public.agentsync_deployments_record(uuid, jsonb, text) to service_role;
grant execute on function public.agentsync_portal_deployments(uuid, text) to service_role;
