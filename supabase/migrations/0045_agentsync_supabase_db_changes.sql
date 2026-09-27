-- Supabase as a connection, and database changes as part of the merge.
--
-- A tenant connects Supabase once (a personal access token, sealed like the
-- GitHub App key and referred to as db:<id>); each project may be linked to
-- one Supabase project. When a change's pull request carries SQL under the
-- project's migration paths, each script is recorded against the task, and
-- the merge waits until every one has been run (through the connection) or a
-- person has said it is already applied.

create table if not exists agentsync.tenant_supabase_connections (
  tenant_id uuid primary key references agentsync.tenants (id) on delete cascade,
  token_reference text not null check (agentsync.is_secret_reference(token_reference)),
  organization text,
  projects jsonb not null default '[]'::jsonb,
  connected_by_email text,
  connected_at timestamptz not null default now()
);
alter table agentsync.tenant_supabase_connections enable row level security;

alter table agentsync.project_repositories
  add column if not exists supabase_project_ref text,
  add column if not exists migration_paths text[] not null default
    array['supabase/migrations/**', 'migrations/**', 'db/migrations/**', 'scripts/**/*.sql', 'sql/**/*.sql'];

create table if not exists agentsync.task_db_changes (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references agentsync.agent_tasks (id) on delete cascade,
  tenant_id uuid not null references agentsync.tenants (id) on delete cascade,
  path text not null,
  blob_sha text,
  status text not null default 'pending' check (status in ('pending', 'applied', 'marked_applied', 'failed')),
  applied_by_email text,
  applied_at timestamptz,
  output text,
  created_at timestamptz not null default now(),
  unique (task_id, path)
);
alter table agentsync.task_db_changes enable row level security;

/* ---- the connection ---------------------------------------------------- */

create or replace function public.agentsync_connect_supabase(
  p_user_id uuid, p_tenant_slug text, p_token_reference text, p_organization text, p_projects jsonb
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid := agentsync.configurable_tenant(p_user_id, p_tenant_slug);
  v_email text;
begin
  if v_tenant is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  end if;
  if not agentsync.is_secret_reference(p_token_reference) then
    return jsonb_build_object('ok', false, 'error', 'SECRET_VALUE_NOT_A_REFERENCE');
  end if;
  select email into v_email from agentsync.users where id = p_user_id;
  insert into agentsync.tenant_supabase_connections as c
    (tenant_id, token_reference, organization, projects, connected_by_email, connected_at)
  values (v_tenant, trim(p_token_reference), nullif(trim(coalesce(p_organization, '')), ''),
          coalesce(p_projects, '[]'::jsonb), v_email, now())
  on conflict (tenant_id) do update set
    token_reference = excluded.token_reference,
    organization = excluded.organization,
    projects = excluded.projects,
    connected_by_email = excluded.connected_by_email,
    connected_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.agentsync_disconnect_supabase(p_user_id uuid, p_tenant_slug text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid := agentsync.configurable_tenant(p_user_id, p_tenant_slug);
  v_ref text;
begin
  if v_tenant is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  end if;
  delete from agentsync.tenant_supabase_connections where tenant_id = v_tenant
  returning token_reference into v_ref;
  -- A token AgentSync was handed is revoked with the connection.
  if v_ref like 'db:%' then
    update agentsync.secret_references set revoked = true where tenant_id = v_tenant and reference = v_ref;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- The tenant's connection as the portal shows it (the reference, never a token).
create or replace function public.agentsync_supabase_connection(p_user_id uuid, p_tenant_slug text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select case when agentsync.readable_tenant(p_user_id, p_tenant_slug) is null
    then jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED')
    else jsonb_build_object('ok', true,
      'can_edit', agentsync.configurable_tenant(p_user_id, p_tenant_slug) is not null,
      'connection', (select jsonb_build_object('organization', c.organization, 'projects', c.projects,
                             'token_reference', c.token_reference, 'connected_by_email', c.connected_by_email,
                             'connected_at', c.connected_at)
                       from agentsync.tenant_supabase_connections c
                      where c.tenant_id = agentsync.readable_tenant(p_user_id, p_tenant_slug)))
  end;
$$;

/* ---- a project's database -------------------------------------------- */

create or replace function public.agentsync_project_database(p_user_id uuid, p_project_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_slug text;
  v_tenant uuid;
begin
  select t.slug into v_slug from agentsync.projects p join agentsync.tenants t on t.id = p.tenant_id where p.id = p_project_id;
  v_tenant := agentsync.readable_tenant(p_user_id, v_slug);
  if v_tenant is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  end if;
  return jsonb_build_object('ok', true,
    'can_edit', agentsync.configurable_tenant(p_user_id, v_slug) is not null,
    'supabase_project_ref', (select r.supabase_project_ref from agentsync.project_repositories r where r.project_id = p_project_id),
    'migration_paths', (select to_jsonb(r.migration_paths) from agentsync.project_repositories r where r.project_id = p_project_id),
    'connection', (select jsonb_build_object('organization', c.organization, 'projects', c.projects)
                     from agentsync.tenant_supabase_connections c where c.tenant_id = v_tenant));
end;
$$;

create or replace function public.agentsync_project_database_set(
  p_user_id uuid, p_project_id uuid, p_supabase_project_ref text, p_migration_paths text[]
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_slug text;
  v_tenant uuid;
begin
  select t.slug into v_slug from agentsync.projects p join agentsync.tenants t on t.id = p.tenant_id where p.id = p_project_id;
  v_tenant := agentsync.configurable_tenant(p_user_id, v_slug);
  if v_tenant is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  end if;
  if p_supabase_project_ref is not null and p_supabase_project_ref !~ '^[a-z0-9]{20}$' then
    return jsonb_build_object('ok', false, 'error', 'BAD_PROJECT_REF');
  end if;
  update agentsync.project_repositories set
    supabase_project_ref = nullif(trim(coalesce(p_supabase_project_ref, '')), ''),
    migration_paths = coalesce(nullif(p_migration_paths, '{}'), migration_paths)
  where project_id = p_project_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- For the worker and the run route: what to run a task's SQL against.
create or replace function public.agentsync_task_database(p_task_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'token_reference', c.token_reference,
    'supabase_project_ref', r.supabase_project_ref,
    'migration_paths', to_jsonb(r.migration_paths),
    'project_name', (select p.name from agentsync.projects p where p.id = t.project_id))
    from agentsync.agent_tasks t
    left join agentsync.project_repositories r on r.project_id = t.project_id
    left join agentsync.tenant_supabase_connections c on c.tenant_id = t.tenant_id
   where t.id = p_task_id;
$$;

/* ---- a task's database changes ---------------------------------------- */

-- The scripts on the task's branch now. A script that changed goes back to
-- pending; one no longer on the branch is dropped.
create or replace function public.agentsync_db_changes_record(p_task_id uuid, p_changes jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_change jsonb;
begin
  select tenant_id into v_tenant from agentsync.agent_tasks where id = p_task_id;
  delete from agentsync.task_db_changes
   where task_id = p_task_id
     and path not in (select c->>'path' from jsonb_array_elements(coalesce(p_changes, '[]'::jsonb)) c);
  for v_change in select * from jsonb_array_elements(coalesce(p_changes, '[]'::jsonb)) loop
    insert into agentsync.task_db_changes as d (task_id, tenant_id, path, blob_sha)
    values (p_task_id, v_tenant, v_change->>'path', v_change->>'sha')
    on conflict (task_id, path) do update set
      blob_sha = excluded.blob_sha,
      status = case when d.blob_sha is distinct from excluded.blob_sha then 'pending' else d.status end,
      output = case when d.blob_sha is distinct from excluded.blob_sha then null else d.output end,
      applied_by_email = case when d.blob_sha is distinct from excluded.blob_sha then null else d.applied_by_email end,
      applied_at = case when d.blob_sha is distinct from excluded.blob_sha then null else d.applied_at end;
  end loop;
end;
$$;

create or replace function public.agentsync_db_changes_for(p_task_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id, 'path', d.path, 'blob_sha', d.blob_sha, 'status', d.status,
    'applied_by_email', d.applied_by_email, 'applied_at', d.applied_at, 'output', d.output) order by d.path), '[]'::jsonb)
    from agentsync.task_db_changes d where d.task_id = p_task_id;
$$;

-- A person records the outcome: run through the connection, or already applied.
create or replace function public.agentsync_db_change_mark(
  p_user_id uuid, p_change_id uuid, p_status text, p_output text default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_change agentsync.task_db_changes;
  v_user agentsync.users;
  v_role agentsync.user_role;
begin
  select * into v_user from agentsync.users where id = p_user_id and state = 'ACTIVE';
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  end if;
  select * into v_change from agentsync.task_db_changes where id = p_change_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NO_SUCH_CHANGE');
  end if;
  select tu.role into v_role from agentsync.tenant_users tu
   where tu.tenant_id = v_change.tenant_id and tu.user_id = p_user_id and tu.state = 'ACTIVE';
  if not (v_user.role = 'SUPER_ADMIN'
          or coalesce(v_role, 'VIEWER') in ('SUPER_ADMIN', 'TENANT_ADMIN', 'APPROVER')) then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  end if;
  if p_status not in ('applied', 'marked_applied', 'failed') then
    return jsonb_build_object('ok', false, 'error', 'BAD_STATUS');
  end if;
  update agentsync.task_db_changes set
    status = p_status,
    applied_by_email = v_user.email,
    applied_at = now(),
    output = left(p_output, 4000)
  where id = p_change_id;
  insert into agentsync.task_events (tenant_id, task_id, event_type, message, actor, correlation_id, metadata)
  select t.tenant_id, t.id,
         case p_status when 'failed' then 'db.change_failed' else 'db.change_applied' end,
         case p_status
           when 'applied' then 'Ran ' || v_change.path || ' on the database'
           when 'marked_applied' then v_change.path || ' marked as already applied'
           else 'Running ' || v_change.path || ' failed: ' || left(coalesce(p_output, ''), 300) end
           || ' (' || v_user.email || ')',
         'user:' || v_user.email, t.correlation_id, jsonb_build_object('path', v_change.path)
    from agentsync.agent_tasks t where t.id = v_change.task_id;
  return jsonb_build_object('ok', true);
end;
$$;

/* ---- the merge waits for them ---------------------------------------- */

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

  -- A change that needs a database change merges only once it has been applied.
  if p_gate = 'merge' and p_decision = 'approved' and exists (
    select 1 from agentsync.task_db_changes c
     where c.task_id = p_task_id and c.status in ('pending', 'failed')
  ) then
    return jsonb_build_object('ok', false, 'error', 'DB_CHANGES_PENDING');
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


revoke all on function public.agentsync_connect_supabase(uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.agentsync_disconnect_supabase(uuid, text) from public, anon, authenticated;
revoke all on function public.agentsync_supabase_connection(uuid, text) from public, anon, authenticated;
revoke all on function public.agentsync_project_database(uuid, uuid) from public, anon, authenticated;
revoke all on function public.agentsync_project_database_set(uuid, uuid, text, text[]) from public, anon, authenticated;
revoke all on function public.agentsync_task_database(uuid) from public, anon, authenticated;
revoke all on function public.agentsync_db_changes_record(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.agentsync_db_changes_for(uuid) from public, anon, authenticated;
revoke all on function public.agentsync_db_change_mark(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.agentsync_connect_supabase(uuid, text, text, text, jsonb) to service_role;
grant execute on function public.agentsync_disconnect_supabase(uuid, text) to service_role;
grant execute on function public.agentsync_supabase_connection(uuid, text) to service_role;
grant execute on function public.agentsync_project_database(uuid, uuid) to service_role;
grant execute on function public.agentsync_project_database_set(uuid, uuid, text, text[]) to service_role;
grant execute on function public.agentsync_task_database(uuid) to service_role;
grant execute on function public.agentsync_db_changes_record(uuid, jsonb) to service_role;
grant execute on function public.agentsync_db_changes_for(uuid) to service_role;
grant execute on function public.agentsync_db_change_mark(uuid, uuid, text, text) to service_role;
