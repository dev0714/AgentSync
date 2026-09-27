-- Retry a failed task: a person sends it back to the queue and it starts
-- again from Analyse, on the same task (and so the same ticket and
-- idempotency key — a source resending the ticket gets this task back, not a
-- new one). Only a human may do it, and only someone who could approve the
-- task's work. The failure stays in the task's history.

insert into agentsync.task_transitions (from_status, to_status, requires_human, note)
values ('failed', 'queued', true, 'retried by a human')
on conflict do nothing;

create or replace function agentsync.retry_task(
  p_user_id uuid,
  p_task_id uuid,
  p_comment text default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_task agentsync.agent_tasks;
  v_user agentsync.users;
  v_role agentsync.user_role;
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

  perform set_config('agentsync.human_decision', 'on', true);
  perform agentsync.transition_task(
    p_task_id, 'queued', 'user:' || v_user.email,
    'Retried by ' || v_user.email
      || coalesce(' after ' || v_task.error_code, '')
      || coalesce(': ' || nullif(trim(p_comment), ''), ''),
    jsonb_build_object('retried_after', v_task.error_code)
  );
  perform set_config('agentsync.human_decision', 'off', true);

  -- Start clean: no error, no working data from the failed run (the next
  -- Analyse rebuilds it), no lease, and straight to the front of the queue.
  -- The branch and pull request are kept so a retry reuses them.
  update agentsync.agent_tasks
     set error_code = null,
         completed_at = null,
         progress_percent = 0,
         stage_state = '{}'::jsonb,
         repair_attempts = 0,
         commit_sha = null,
         locked_by = null,
         lock_expires_at = null,
         next_attempt_at = null
   where id = p_task_id;

  return jsonb_build_object('ok', true, 'status', 'queued');
end;
$$;

create or replace function public.agentsync_retry_task(
  p_user_id uuid, p_task_id uuid, p_comment text default null
)
returns jsonb
language sql security definer set search_path = ''
as $$ select agentsync.retry_task(p_user_id, p_task_id, p_comment); $$;

revoke all on function agentsync.retry_task(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.agentsync_retry_task(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.agentsync_retry_task(uuid, uuid, text) to service_role;
