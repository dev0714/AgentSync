-- Documents attached to a request: specs, screenshots, sample data.
--
-- The original lives in the private `task-attachments` storage bucket. The
-- worker extracts text once (DOCX, XLSX, plain text), and hands each file to
-- whichever provider an agent runs on — the provider's file id is cached here
-- and the provider copy is deleted when the task ends.

insert into storage.buckets (id, name, public, file_size_limit)
values ('task-attachments', 'task-attachments', false, 26214400)
on conflict (id) do nothing;

create table agentsync.task_attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references agentsync.tenants (id) on delete cascade,
  project_id uuid not null references agentsync.projects (id) on delete cascade,
  task_id uuid references agentsync.agent_tasks (id) on delete cascade,
  uploaded_by uuid references agentsync.users (id),
  filename text not null,
  media_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 26214400),
  storage_path text not null unique,
  sha256 text,
  extracted_text text,
  status text not null default 'pending' check (status in ('pending', 'ready', 'rejected')),
  problem text,
  anthropic_file_id text,
  openai_file_id text,
  created_at timestamptz not null default now()
);
create index task_attachments_task_idx on agentsync.task_attachments (task_id);
alter table agentsync.task_attachments enable row level security;

create or replace function agentsync.attachment_type_allowed(p_media_type text)
returns boolean language sql immutable set search_path = ''
as $$
  select p_media_type in (
    'application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp',
    'text/plain', 'text/markdown', 'text/csv', 'application/json',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
$$;

-- Who may attach and submit: the same roles as portal submission.
create or replace function agentsync.may_submit(p_user_id uuid, p_project_id uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select p.tenant_id from agentsync.projects p
   where p.id = p_project_id and p.enabled
     and (exists (select 1 from agentsync.users u where u.id = p_user_id and u.state = 'ACTIVE' and u.role = 'SUPER_ADMIN')
          or exists (select 1 from agentsync.tenant_users tu
                      where tu.tenant_id = p.tenant_id and tu.user_id = p_user_id and tu.state = 'ACTIVE'
                        and tu.role in ('SUPER_ADMIN', 'TENANT_ADMIN', 'PROJECT_MANAGER', 'DEVELOPER', 'APPROVER')));
$$;

-- Reserves a row and a storage path for a browser upload.
create or replace function public.agentsync_attachment_reserve(
  p_user_id uuid, p_project_id uuid, p_filename text, p_media_type text, p_size bigint
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_id uuid := gen_random_uuid();
  v_name text;
  v_path text;
begin
  v_tenant := agentsync.may_submit(p_user_id, p_project_id);
  if v_tenant is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  end if;
  if not agentsync.attachment_type_allowed(p_media_type) then
    return jsonb_build_object('ok', false, 'error', 'TYPE_NOT_ALLOWED', 'detail', p_media_type);
  end if;
  if p_size is null or p_size <= 0 or p_size > 26214400 then
    return jsonb_build_object('ok', false, 'error', 'TOO_LARGE');
  end if;

  v_name := coalesce(nullif(regexp_replace(trim(p_filename), '[^A-Za-z0-9._-]+', '_', 'g'), ''), 'file');
  v_path := v_tenant::text || '/' || v_id::text || '/' || left(v_name, 120);

  insert into agentsync.task_attachments (id, tenant_id, project_id, uploaded_by, filename, media_type, size_bytes, storage_path)
  values (v_id, v_tenant, p_project_id, p_user_id, left(trim(p_filename), 255), p_media_type, p_size, v_path);

  return jsonb_build_object('ok', true, 'attachment_id', v_id, 'storage_path', v_path);
end;
$$;

-- API submissions: the server has the bytes and uploads them itself.
create or replace function public.agentsync_add_task_attachment(
  p_task_id uuid, p_filename text, p_media_type text, p_size bigint
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_task agentsync.agent_tasks;
  v_id uuid := gen_random_uuid();
  v_path text;
begin
  select * into v_task from agentsync.agent_tasks where id = p_task_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'NO_SUCH_TASK'); end if;
  if not agentsync.attachment_type_allowed(p_media_type) then
    return jsonb_build_object('ok', false, 'error', 'TYPE_NOT_ALLOWED', 'detail', p_media_type);
  end if;
  if (select count(*) from agentsync.task_attachments where task_id = p_task_id) >= 10 then
    return jsonb_build_object('ok', false, 'error', 'TOO_MANY');
  end if;
  v_path := v_task.tenant_id::text || '/' || v_id::text || '/'
            || left(coalesce(nullif(regexp_replace(trim(p_filename), '[^A-Za-z0-9._-]+', '_', 'g'), ''), 'file'), 120);
  insert into agentsync.task_attachments (id, tenant_id, project_id, task_id, filename, media_type, size_bytes, storage_path)
  values (v_id, v_task.tenant_id, v_task.project_id, p_task_id, left(trim(p_filename), 255), p_media_type, p_size, v_path);
  return jsonb_build_object('ok', true, 'attachment_id', v_id, 'storage_path', v_path);
end;
$$;

create or replace function public.agentsync_task_attachments(p_task_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at), '[]'::jsonb)
    from agentsync.task_attachments a where a.task_id = p_task_id;
$$;

create or replace function public.agentsync_update_attachment(p_id uuid, p_fields jsonb)
returns void
language sql security definer set search_path = ''
as $$
  update agentsync.task_attachments set
    sha256 = case when p_fields ? 'sha256' then p_fields->>'sha256' else sha256 end,
    extracted_text = case when p_fields ? 'extracted_text' then p_fields->>'extracted_text' else extracted_text end,
    status = case when p_fields ? 'status' then p_fields->>'status' else status end,
    problem = case when p_fields ? 'problem' then p_fields->>'problem' else problem end,
    anthropic_file_id = case when p_fields ? 'anthropic_file_id' then p_fields->>'anthropic_file_id' else anthropic_file_id end,
    openai_file_id = case when p_fields ? 'openai_file_id' then p_fields->>'openai_file_id' else openai_file_id end
  where id = p_id;
$$;

-- The portal's view of a task's attachments, for members of its tenant.
create or replace function public.agentsync_portal_task_attachments(p_user_id uuid, p_task_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'filename', a.filename, 'media_type', a.media_type,
           'size_bytes', a.size_bytes, 'status', a.status, 'problem', a.problem,
           'storage_path', a.storage_path,
           'extracted_text', left(a.extracted_text, 20000)
         ) order by a.created_at), '[]'::jsonb)
    from agentsync.task_attachments a
    join agentsync.agent_tasks t on t.id = a.task_id
   where a.task_id = p_task_id
     and (exists (select 1 from agentsync.users u where u.id = p_user_id and u.state = 'ACTIVE' and u.role = 'SUPER_ADMIN')
          or exists (select 1 from agentsync.tenant_users tu
                      where tu.tenant_id = t.tenant_id and tu.user_id = p_user_id and tu.state = 'ACTIVE'));
$$;

-- Portal submission links the files uploaded for it.
drop function if exists public.agentsync_portal_submit_task(uuid, uuid, text, text, text, text, text[], text);

create or replace function public.agentsync_portal_submit_task(
  p_user_id uuid,
  p_project_id uuid,
  p_title text,
  p_description text default null,
  p_request_type text default 'code_change',
  p_priority text default 'normal',
  p_acceptance_criteria text[] default '{}',
  p_tier text default null,
  p_attachment_ids uuid[] default '{}'
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_user agentsync.users;
  v_project agentsync.projects;
  v_role agentsync.user_role;
  v_row record;
  v_count integer;
  v_total bigint;
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
  if p_tier is not null and p_tier not in ('low', 'medium', 'high') then
    return jsonb_build_object('ok', false, 'error', 'UNKNOWN_TIER');
  end if;

  select count(*), coalesce(sum(size_bytes), 0) into v_count, v_total
    from agentsync.task_attachments
   where id = any(coalesce(p_attachment_ids, '{}')) and uploaded_by = p_user_id
     and project_id = p_project_id and task_id is null;
  if v_count <> coalesce(array_length(p_attachment_ids, 1), 0) then
    return jsonb_build_object('ok', false, 'error', 'ATTACHMENT_NOT_FOUND');
  end if;
  if v_count > 10 then
    return jsonb_build_object('ok', false, 'error', 'TOO_MANY_ATTACHMENTS');
  end if;
  if v_total > 52428800 then
    return jsonb_build_object('ok', false, 'error', 'ATTACHMENTS_TOO_LARGE');
  end if;

  select * into v_row from agentsync.submit_task(
    v_project.tenant_id, v_project.id, null,
    'portal:' || gen_random_uuid()::text,
    p_title, nullif(trim(coalesce(p_description, '')), ''), null,
    p_request_type::agentsync.request_type, p_priority::agentsync.task_priority,
    coalesce(p_acceptance_criteria, '{}'),
    jsonb_build_object('id', v_user.id, 'name', v_user.display_name,
                       'email', v_user.email, 'via', 'portal'),
    null
  );

  if p_tier is not null then
    update agentsync.agent_tasks set tier = p_tier where id = v_row.task_id;
  end if;
  update agentsync.task_attachments set task_id = v_row.task_id
   where id = any(coalesce(p_attachment_ids, '{}'));

  return jsonb_build_object('ok', true, 'task_id', v_row.task_id,
                            'correlation_id', v_row.correlation_id, 'status', v_row.status);
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.agentsync_attachment_reserve(uuid, uuid, text, text, bigint)',
    'public.agentsync_add_task_attachment(uuid, text, text, bigint)',
    'public.agentsync_task_attachments(uuid)',
    'public.agentsync_update_attachment(uuid, jsonb)',
    'public.agentsync_portal_task_attachments(uuid, uuid)',
    'public.agentsync_portal_submit_task(uuid, uuid, text, text, text, text, text[], text, uuid[])'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
