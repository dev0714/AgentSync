-- Sending a plan back re-runs Analyse, not just the Planner: the person's
-- answer (often the screen or file the request means) goes into the code-map
-- search and the files read, so the new plan starts from better context. The
-- answer still reaches the Planner as feedback.

insert into agentsync.task_transitions (from_status, to_status, requires_human, note)
values ('awaiting_plan_approval', 'analysing', true, 'plan sent back: analyse again with the answer')
on conflict do nothing;

create or replace function agentsync.decide_approval(
  p_user_id uuid,
  p_task_id uuid,
  p_gate text,
  p_decision text,
  p_comment text default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_task agentsync.agent_tasks;
  v_user agentsync.users;
  v_role agentsync.user_role;
  v_expected agentsync.task_status;
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

  v_expected := case p_gate
    when 'plan' then 'awaiting_plan_approval'
    when 'merge' then 'awaiting_merge_approval'
    when 'production' then 'awaiting_production_approval'
    else null end;
  if v_expected is null then
    return jsonb_build_object('ok', false, 'error', 'UNKNOWN_GATE');
  end if;
  if v_task.status <> v_expected then
    return jsonb_build_object('ok', false, 'error', 'NOT_AT_GATE', 'detail', v_task.status);
  end if;

  if p_decision not in ('approved', 'rejected', 'changes_requested') then
    return jsonb_build_object('ok', false, 'error', 'UNKNOWN_DECISION');
  end if;
  if p_decision = 'changes_requested' and coalesce(trim(p_comment), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'COMMENT_REQUIRED');
  end if;

  v_to := case p_gate || ':' || p_decision
    when 'plan:approved' then 'implementing'
    when 'plan:changes_requested' then 'analysing'
    when 'plan:rejected' then 'cancelled'
    when 'merge:approved' then 'deploying_production'
    when 'merge:changes_requested' then 'implementing'
    when 'merge:rejected' then 'cancelled'
    when 'production:approved' then 'deploying_production'
    when 'production:rejected' then 'cancelled'
    else null end;
  if v_to is null then
    return jsonb_build_object('ok', false, 'error', 'UNSUPPORTED_DECISION');
  end if;

  update agentsync.task_approvals
     set decision = p_decision::agentsync.approval_decision,
         decided_by = v_user.id,
         decided_by_email = v_user.email,
         decided_by_role = coalesce(v_role, v_user.role),
         comments = nullif(trim(p_comment), ''),
         decided_at = now()
   where task_id = p_task_id and gate = p_gate::agentsync.approval_gate and decision = 'pending';
  if not found then
    insert into agentsync.task_approvals (
      tenant_id, task_id, gate, decision, decided_by, decided_by_email,
      decided_by_role, comments, decided_at
    ) values (
      v_task.tenant_id, p_task_id, p_gate::agentsync.approval_gate,
      p_decision::agentsync.approval_decision, v_user.id, v_user.email,
      coalesce(v_role, v_user.role), nullif(trim(p_comment), ''), now()
    );
  end if;

  perform set_config('agentsync.human_decision', 'on', true);
  perform agentsync.transition_task(
    p_task_id, v_to, 'user:' || v_user.email,
    initcap(p_gate) || ' ' || replace(p_decision, '_', ' ') || ' by ' || v_user.email
      || coalesce(': ' || nullif(trim(p_comment), ''), '')
  );
  perform set_config('agentsync.human_decision', 'off', true);

  -- The next tick should pick it up straight away.
  update agentsync.agent_tasks
     set locked_by = null, lock_expires_at = null, next_attempt_at = null,
         repair_attempts = case when p_decision = 'changes_requested' then 0 else repair_attempts end
   where id = p_task_id;

  return jsonb_build_object('ok', true, 'status', v_to,
                            'pull_request_number', v_task.pull_request_number);
end;
$$;
