-- Stop a task a person no longer wants running (usually the Engineer's
-- sandbox, which bills while it works). Only someone who could approve the
-- task's work may, and only while an agent is building or checking it. The
-- task fails with STOPPED_BY_USER, so it can be retried later. The caller
-- stops the sandbox session itself; this records the decision and the move.

create or replace function agentsync.stop_task(p_user_id uuid, p_task_id uuid)
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
  if v_task.status not in ('implementing', 'testing') then
    return jsonb_build_object('ok', false, 'error', 'NOT_RUNNING', 'detail', v_task.status);
  end if;

  update agentsync.agent_tasks set error_code = 'STOPPED_BY_USER' where id = p_task_id;
  perform agentsync.transition_task(
    p_task_id, 'failed', 'user:' || v_user.email, 'Stopped by ' || v_user.email
  );
  return jsonb_build_object('ok', true, 'status', 'failed');
end;
$$;

create or replace function public.agentsync_stop_task(p_user_id uuid, p_task_id uuid)
returns jsonb
language sql security definer set search_path = ''
as $$ select agentsync.stop_task(p_user_id, p_task_id); $$;

revoke all on function agentsync.stop_task(uuid, uuid) from public, anon, authenticated;
revoke all on function public.agentsync_stop_task(uuid, uuid) from public, anon, authenticated;
grant execute on function public.agentsync_stop_task(uuid, uuid) to service_role;
