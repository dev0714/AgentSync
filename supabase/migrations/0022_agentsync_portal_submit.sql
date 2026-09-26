-- Submitting a request from a project in the portal.
--
-- The same submit_task path the API uses — validation, queue, events, gates —
-- attributed to the signed-in person instead of a source system. Viewers can
-- look but not submit.

create or replace function public.agentsync_portal_submit_task(
  p_user_id uuid,
  p_project_id uuid,
  p_title text,
  p_description text default null,
  p_request_type text default 'code_change',
  p_priority text default 'normal',
  p_acceptance_criteria text[] default '{}'
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_user agentsync.users;
  v_project agentsync.projects;
  v_role agentsync.user_role;
  v_row record;
begin
  select * into v_user from agentsync.users where id = p_user_id and state = 'ACTIVE';
  select * into v_project from agentsync.projects where id = p_project_id;
  if v_user.id is null or v_project.id is null then
    return jsonb_build_object('ok', false, 'error', case when v_user.id is null
      then 'NOT_AUTHORISED' else 'PROJECT_NOT_FOUND' end);
  end if;

  select tu.role into v_role from agentsync.tenant_users tu
   where tu.tenant_id = v_project.tenant_id and tu.user_id = p_user_id and tu.state = 'ACTIVE';

  if not (v_user.role = 'SUPER_ADMIN'
          or coalesce(v_role, 'VIEWER') in
             ('SUPER_ADMIN', 'TENANT_ADMIN', 'PROJECT_MANAGER', 'DEVELOPER', 'APPROVER')) then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  end if;

  if not v_project.enabled then
    return jsonb_build_object('ok', false, 'error', 'PROJECT_DISABLED');
  end if;

  select * into v_row from agentsync.submit_task(
    v_project.tenant_id,
    v_project.id,
    null,
    'portal:' || gen_random_uuid()::text,
    p_title,
    nullif(trim(coalesce(p_description, '')), ''),
    null,
    p_request_type::agentsync.request_type,
    p_priority::agentsync.task_priority,
    coalesce(p_acceptance_criteria, '{}'),
    jsonb_build_object('id', v_user.id, 'name', v_user.display_name,
                       'email', v_user.email, 'via', 'portal'),
    null
  );

  return jsonb_build_object('ok', true, 'task_id', v_row.task_id,
                            'correlation_id', v_row.correlation_id, 'status', v_row.status);
end;
$$;

revoke all on function public.agentsync_portal_submit_task(uuid, uuid, text, text, text, text, text[]) from public, anon, authenticated;
grant execute on function public.agentsync_portal_submit_task(uuid, uuid, text, text, text, text, text[]) to service_role;
