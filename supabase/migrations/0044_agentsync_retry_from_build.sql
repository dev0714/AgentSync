-- Retry picks up where the task stopped. A task that failed while building or
-- checking, with its current plan approved, goes straight back to the
-- Engineer on the same plan and branch — no new plan, no second approval.
-- Anything else (or when asked) starts again from Analyse, as before.

insert into agentsync.task_transitions (from_status, to_status, requires_human, note)
values ('failed', 'implementing', true, 'retried from the build with the approved plan')
on conflict do nothing;

-- Where a failed task stopped, and whether it can resume the build.
create or replace function agentsync.retry_point(p_task_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with stopped as (
    select e.metadata->>'from' as stage
      from agentsync.task_events e
     where e.task_id = p_task_id and e.event_type = 'task.status_changed' and e.metadata->>'to' = 'failed'
     order by e.created_at desc limit 1
  ), plan as (
    select p.version, p.created_at, coalesce(array_length(p.affected_files, 1), 0) as files
      from agentsync.task_plans p where p.task_id = p_task_id order by p.version desc limit 1
  ), approved as (
    select exists (
      select 1 from agentsync.task_approvals a, plan
       where a.task_id = p_task_id and a.gate = 'plan' and a.decision = 'approved'
         and a.decided_at >= plan.created_at
    ) as ok
  )
  select jsonb_build_object(
    'stage', (select stage from stopped),
    'plan_version', (select version from plan),
    'can_resume_build', coalesce((select stage from stopped) in ('implementing', 'testing'), false)
                        and coalesce((select files from plan), 0) > 0
                        and (select ok from approved)
  );
$$;

drop function if exists public.agentsync_retry_task(uuid, uuid, text);
drop function if exists agentsync.retry_task(uuid, uuid, text);

create or replace function agentsync.retry_task(
  p_user_id uuid,
  p_task_id uuid,
  p_comment text default null,
  p_from text default 'auto'   -- 'auto' | 'build' | 'start'
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_task agentsync.agent_tasks;
  v_user agentsync.users;
  v_role agentsync.user_role;
  v_point jsonb;
  v_build boolean;
  v_to agentsync.task_status;
begin
  select * into v_user from agentsync.users where id = p_user_id and state = 'ACTIVE';
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  end if;
  select * into v_task from agentsync.agent_tasks where id = p_task_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NO_SUCH_TASK');
  end if;
  select tu.role into v_role from agentsync.tenant_users tu
   where tu.tenant_id = v_task.tenant_id and tu.user_id = p_user_id and tu.state = 'ACTIVE';
  if not (v_user.role = 'SUPER_ADMIN'
          or coalesce(v_role, 'VIEWER') in ('SUPER_ADMIN', 'TENANT_ADMIN', 'APPROVER')) then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  end if;
  if v_task.status <> 'failed' then
    return jsonb_build_object('ok', false, 'error', 'NOT_FAILED', 'detail', v_task.status);
  end if;

  v_point := agentsync.retry_point(p_task_id);
  v_build := case p_from
    when 'build' then (v_point->>'can_resume_build')::boolean
    when 'start' then false
    else (v_point->>'can_resume_build')::boolean end;
  if p_from = 'build' and not v_build then
    return jsonb_build_object('ok', false, 'error', 'CANNOT_RESUME_BUILD');
  end if;
  v_to := case when v_build then 'implementing' else 'queued' end;

  perform set_config('agentsync.human_decision', 'on', true);
  perform agentsync.transition_task(
    p_task_id, v_to, 'user:' || v_user.email,
    'Retried by ' || v_user.email
      || case when v_build then ' from the build (plan v' || (v_point->>'plan_version') || ' stays approved)' else ' from the start' end
      || coalesce(' after ' || v_task.error_code, '')
      || coalesce(': ' || nullif(trim(p_comment), ''), ''),
    jsonb_build_object('retried_after', v_task.error_code, 'from', case when v_build then 'build' else 'start' end)
  );
  perform set_config('agentsync.human_decision', 'off', true);

  -- Resuming the build keeps the plan's context, map and branch; only the
  -- finished sandbox session and old repair notes go. Starting over clears all.
  update agentsync.agent_tasks
     set error_code = null,
         completed_at = null,
         progress_percent = case when v_build then 45 else 0 end,
         stage_state = case when v_build
           then stage_state - 'session_id' - 'resource_id' - 'session_provider' - 'session_usage'
                            - 'repair_feedback' - 'checks_done_for' - 'checks_since'
           else '{}'::jsonb end,
         repair_attempts = 0,
         commit_sha = case when v_build then commit_sha else null end,
         locked_by = null,
         lock_expires_at = null,
         next_attempt_at = null
   where id = p_task_id;

  return jsonb_build_object('ok', true, 'status', v_to, 'from', case when v_build then 'build' else 'start' end);
end;
$$;

create or replace function public.agentsync_retry_task(
  p_user_id uuid, p_task_id uuid, p_comment text default null, p_from text default 'auto'
)
returns jsonb
language sql security definer set search_path = ''
as $$ select agentsync.retry_task(p_user_id, p_task_id, p_comment, p_from); $$;

create or replace function public.agentsync_retry_point(p_task_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$ select agentsync.retry_point(p_task_id); $$;

revoke all on function agentsync.retry_point(uuid) from public, anon, authenticated;
revoke all on function agentsync.retry_task(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.agentsync_retry_task(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.agentsync_retry_point(uuid) from public, anon, authenticated;
grant execute on function public.agentsync_retry_task(uuid, uuid, text, text) to service_role;
grant execute on function public.agentsync_retry_point(uuid) to service_role;
