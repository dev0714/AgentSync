-- A source system's own clients, mapped to projects.
--
-- A service desk (LeadSync) knows its tickets by client, not by repository.
-- It sends the client with each task, and AgentSync routes the task to the
-- project the client is mapped to here. Unmapped clients are recorded as they
-- arrive so they can be mapped from the portal; their tasks are refused with
-- CLIENT_NOT_MAPPED until then.

create table agentsync.source_clients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references agentsync.tenants (id) on delete cascade,
  source_system_id uuid not null references agentsync.source_systems (id) on delete cascade,
  external_id text not null check (length(external_id) between 1 and 200),
  name text not null check (length(name) between 1 and 300),
  project_id uuid references agentsync.projects (id) on delete set null,
  active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_system_id, external_id)
);

create index source_clients_tenant_idx on agentsync.source_clients (tenant_id);
alter table agentsync.source_clients enable row level security;

-- Callbacks to a source are signed with the source's own secret when it has one.
alter table agentsync.source_systems add column if not exists callback_secret_ref text;

-- A short, plain-language note for the requester, written with the pull request.
alter table agentsync.agent_tasks add column if not exists client_note text;

/* ---- upsert a client as the source reports it ------------------------- */

create or replace function agentsync.touch_source_client(
  p_tenant_id uuid, p_source_id uuid, p_external_id text, p_name text, p_active boolean default true
)
returns agentsync.source_clients
language plpgsql security definer set search_path = ''
as $$
declare
  v_row agentsync.source_clients;
begin
  insert into agentsync.source_clients (tenant_id, source_system_id, external_id, name, active)
  values (p_tenant_id, p_source_id, left(trim(p_external_id), 200),
          left(coalesce(nullif(trim(p_name), ''), trim(p_external_id)), 300), coalesce(p_active, true))
  on conflict (source_system_id, external_id) do update
    set name = excluded.name,
        active = excluded.active,
        last_seen_at = now(),
        updated_at = now()
  returning * into v_row;
  return v_row;
end;
$$;

/* ---- submission: project_id, or a client mapped to one ----------------- */

create or replace function public.agentsync_submit_task(payload jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_auth record;
  v_result record;
  v_project uuid;
  v_client agentsync.source_clients;
begin
  select * into v_auth
    from agentsync.authenticate_source(payload->>'api_key', nullif(payload->>'ip', '')::inet);

  if v_auth.reason is not null then
    return jsonb_build_object('ok', false, 'error', v_auth.reason);
  end if;

  v_project := nullif(payload->>'project_id', '')::uuid;

  if v_project is null and nullif(trim(payload #>> '{client,id}'), '') is not null then
    v_client := agentsync.touch_source_client(
      v_auth.tenant_id, v_auth.source_system_id,
      payload #>> '{client,id}', payload #>> '{client,name}');
    if v_client.project_id is null then
      return jsonb_build_object('ok', false, 'error', 'CLIENT_NOT_MAPPED',
                                'client', jsonb_build_object('id', v_client.external_id, 'name', v_client.name));
    end if;
    v_project := v_client.project_id;
  end if;

  if v_project is null then
    return jsonb_build_object('ok', false, 'error', 'PROJECT_NOT_FOUND');
  end if;

  select * into v_result
    from agentsync.submit_task(
      v_auth.tenant_id,
      v_project,
      v_auth.source_system_id,
      payload->>'idempotency_key',
      payload->>'title',
      payload->>'description',
      payload->>'external_reference',
      coalesce(nullif(payload->>'request_type',''), 'code_change')::agentsync.request_type,
      coalesce(nullif(payload->>'priority',''), 'normal')::agentsync.task_priority,
      coalesce(
        (select array_agg(value::text) from jsonb_array_elements_text(
           coalesce(payload->'acceptance_criteria', '[]'::jsonb))),
        '{}'::text[]
      ),
      case when v_client.id is null then payload->'requested_by'
           else coalesce(payload->'requested_by', '{}'::jsonb)
                || jsonb_build_object('client_id', v_client.external_id, 'client_name', v_client.name) end,
      nullif(payload->>'callback_url','')
    );

  return jsonb_build_object(
    'ok', true,
    'task_id', v_result.task_id,
    'correlation_id', v_result.correlation_id,
    'status', v_result.status,
    'created', v_result.created,
    'project_id', v_project
  );
end;
$$;

/* ---- bulk client sync from a source ------------------------------------ */

-- payload: {api_key, ip, clients: [{id, name, active?}]}. Clients missing from
-- a full sync are left as they are; a source sends active=false to retire one.
create or replace function public.agentsync_source_sync_clients(payload jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_auth record;
  v_item jsonb;
  v_count integer := 0;
begin
  select * into v_auth
    from agentsync.authenticate_source(payload->>'api_key', nullif(payload->>'ip', '')::inet);
  if v_auth.reason is not null and v_auth.reason <> 'RATE_LIMITED' then
    return jsonb_build_object('ok', false, 'error', v_auth.reason);
  end if;
  if jsonb_typeof(payload->'clients') <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'VALIDATION_FAILED');
  end if;
  if jsonb_array_length(payload->'clients') > 5000 then
    return jsonb_build_object('ok', false, 'error', 'VALIDATION_FAILED');
  end if;

  for v_item in select * from jsonb_array_elements(payload->'clients') loop
    continue when nullif(trim(v_item->>'id'), '') is null;
    perform agentsync.touch_source_client(
      v_auth.tenant_id, v_auth.source_system_id, v_item->>'id', v_item->>'name',
      coalesce((v_item->>'active')::boolean, true));
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'synced', v_count,
    'mapped', (select count(*) from agentsync.source_clients c
                where c.source_system_id = v_auth.source_system_id and c.project_id is not null)
  );
end;
$$;

/* ---- portal: list and map a source's clients ---------------------------- */

create or replace function agentsync.source_in_tenant(p_user_id uuid, p_tenant_slug text, p_source_id uuid)
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  v_tenant := agentsync.configurable_tenant(p_user_id, p_tenant_slug);
  if v_tenant is null then return null; end if;
  if not exists (select 1 from agentsync.source_systems s where s.id = p_source_id and s.tenant_id = v_tenant) then
    return null;
  end if;
  return v_tenant;
end;
$$;

create or replace function public.agentsync_portal_source_clients(
  p_user_id uuid, p_tenant_slug text, p_source_id uuid
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  v_tenant := agentsync.source_in_tenant(p_user_id, p_tenant_slug, p_source_id);
  if v_tenant is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  end if;

  return jsonb_build_object(
    'ok', true,
    'has_callback_secret', (select s.callback_secret_ref is not null
                              from agentsync.source_systems s where s.id = p_source_id),
    'clients', coalesce((
      select jsonb_agg(jsonb_build_object(
               'external_id', c.external_id,
               'name', c.name,
               'project_id', c.project_id,
               'active', c.active,
               'last_seen_at', c.last_seen_at,
               'task_count', (select count(*) from agentsync.agent_tasks t
                               where t.source_system_id = c.source_system_id
                                 and t.requested_by->>'client_id' = c.external_id))
             order by (c.project_id is null) desc, lower(c.name))
        from agentsync.source_clients c
       where c.source_system_id = p_source_id
    ), '[]'::jsonb),
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'enabled', p.enabled)
             order by lower(p.name))
        from agentsync.projects p
       where p.tenant_id = v_tenant
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.agentsync_portal_map_source_client(
  p_user_id uuid, p_tenant_slug text, p_source_id uuid, p_external_id text, p_project_id uuid
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  v_tenant := agentsync.source_in_tenant(p_user_id, p_tenant_slug, p_source_id);
  if v_tenant is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  end if;
  if p_project_id is not null
     and not exists (select 1 from agentsync.projects p where p.id = p_project_id and p.tenant_id = v_tenant) then
    return jsonb_build_object('ok', false, 'error', 'PROJECT_NOT_FOUND');
  end if;

  update agentsync.source_clients c
     set project_id = p_project_id, updated_at = now()
   where c.source_system_id = p_source_id and c.external_id = p_external_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'CLIENT_NOT_FOUND');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- The caller has already sealed the new secret and stored it (store_secret);
-- this points the source at it and revokes the previous one.
create or replace function public.agentsync_portal_set_source_callback_secret(
  p_user_id uuid, p_tenant_slug text, p_source_id uuid, p_reference text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_old text;
begin
  v_tenant := agentsync.source_in_tenant(p_user_id, p_tenant_slug, p_source_id);
  if v_tenant is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  end if;
  if p_reference !~ '^db:[0-9a-f-]{36}$' then
    return jsonb_build_object('ok', false, 'error', 'VALIDATION_FAILED');
  end if;

  select s.callback_secret_ref into v_old from agentsync.source_systems s where s.id = p_source_id;
  update agentsync.source_systems s set callback_secret_ref = p_reference where s.id = p_source_id;
  if v_old is not null and v_old <> p_reference then
    update agentsync.secret_references r set revoked = true
     where r.tenant_id = v_tenant and r.reference = v_old;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

/* ---- worker: what a callback needs about the task's source ------------- */

create or replace function public.agentsync_callback_context(p_task_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'source_secret_ref', s.callback_secret_ref,
    'client_note', t.client_note,
    'plan_summary', (select pl.summary from agentsync.task_plans pl
                      where pl.task_id = t.id order by pl.version desc limit 1)
  )
    from agentsync.agent_tasks t
    left join agentsync.source_systems s on s.id = t.source_system_id
   where t.id = p_task_id;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'agentsync.touch_source_client(uuid, uuid, text, text, boolean)',
    'agentsync.source_in_tenant(uuid, text, uuid)',
    'public.agentsync_submit_task(jsonb)',
    'public.agentsync_source_sync_clients(jsonb)',
    'public.agentsync_portal_source_clients(uuid, text, uuid)',
    'public.agentsync_portal_map_source_client(uuid, text, uuid, text, uuid)',
    'public.agentsync_portal_set_source_callback_secret(uuid, text, uuid, text)',
    'public.agentsync_callback_context(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
