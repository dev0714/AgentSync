-- Whether a person may make decisions on a task's work (approvers and
-- admins of its tenant) — checked before AgentSync runs anything on a
-- client's database on their behalf.
create or replace function public.agentsync_can_approve(p_user_id uuid, p_task_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
      from agentsync.agent_tasks t
      join agentsync.users u on u.id = p_user_id and u.state = 'ACTIVE'
      left join agentsync.tenant_users tu
        on tu.tenant_id = t.tenant_id and tu.user_id = p_user_id and tu.state = 'ACTIVE'
     where t.id = p_task_id
       and (u.role = 'SUPER_ADMIN' or coalesce(tu.role, 'VIEWER') in ('SUPER_ADMIN', 'TENANT_ADMIN', 'APPROVER'))
  );
$$;
revoke all on function public.agentsync_can_approve(uuid, uuid) from public, anon, authenticated;
grant execute on function public.agentsync_can_approve(uuid, uuid) to service_role;
