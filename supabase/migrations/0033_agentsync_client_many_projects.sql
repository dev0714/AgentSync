-- A source's client can be mapped to several repositories (projects).
--
-- A ticket still goes to exactly one. With one mapping it goes straight there;
-- with several, the submission answers ROUTING_REQUIRED with the candidates,
-- AgentSync's router (a small model call) picks one and submits again with
-- that project_id — or, when it can't tell, the source asks a person.

create table agentsync.source_client_projects (
  source_client_id uuid not null references agentsync.source_clients (id) on delete cascade,
  project_id uuid not null references agentsync.projects (id) on delete cascade,
  tenant_id uuid not null references agentsync.tenants (id) on delete cascade,
  -- What this repository is for this client ("public website", "booking API"),
  -- which is what the router reads when a client has more than one.
  hint text check (hint is null or length(hint) <= 300),
  created_at timestamptz not null default now(),
  primary key (source_client_id, project_id)
);

create index source_client_projects_project_idx on agentsync.source_client_projects (project_id);
alter table agentsync.source_client_projects enable row level security;

insert into agentsync.source_client_projects (source_client_id, project_id, tenant_id)
select c.id, c.project_id, c.tenant_id from agentsync.source_clients c where c.project_id is not null
on conflict do nothing;

/* ---- the repositories a client may be built in, for the router ---------- */

create or replace function agentsync.client_candidates(p_source_client_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'project_id', p.id,
           'name', p.name,
           'repository', (select r.github_owner || '/' || r.repository from agentsync.project_repositories r
                           where r.project_id = p.id order by r.created_at limit 1),
           'hint', m.hint,
           'recent_titles', coalesce((select jsonb_agg(x.title) from (
               select t.title from agentsync.agent_tasks t
                where t.project_id = p.id order by t.created_at desc limit 5) x), '[]'::jsonb)
         ) order by lower(p.name)), '[]'::jsonb)
    from agentsync.source_client_projects m
    join agentsync.projects p on p.id = m.project_id
   where m.source_client_id = p_source_client_id and p.enabled;
$$;

/* ---- submission ------------------------------------------------------------ */

create or replace function public.agentsync_submit_task(payload jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_auth record;
  v_result record;
  v_project uuid;
  v_client agentsync.source_clients;
  v_existing agentsync.agent_tasks;
  v_count integer;
begin
  select * into v_auth
    from agentsync.authenticate_source(payload->>'api_key', nullif(payload->>'ip', '')::inet);
  if v_auth.reason is not null then
    return jsonb_build_object('ok', false, 'error', v_auth.reason);
  end if;

  -- A retry returns the original task before any routing happens again.
  select * into v_existing from agentsync.agent_tasks t
   where t.tenant_id = v_auth.tenant_id and t.idempotency_key = payload->>'idempotency_key';
  if found then
    return jsonb_build_object('ok', true, 'task_id', v_existing.id, 'correlation_id', v_existing.correlation_id,
                              'status', v_existing.status, 'created', false, 'project_id', v_existing.project_id,
                              'project_name', (select name from agentsync.projects where id = v_existing.project_id));
  end if;

  v_project := nullif(payload->>'project_id', '')::uuid;

  if nullif(trim(payload #>> '{client,id}'), '') is not null then
    v_client := agentsync.touch_source_client(
      v_auth.tenant_id, v_auth.source_system_id,
      payload #>> '{client,id}', payload #>> '{client,name}');

    if v_project is not null then
      -- A chosen repository must be one this client is mapped to.
      if not exists (select 1 from agentsync.source_client_projects m
                      where m.source_client_id = v_client.id and m.project_id = v_project) then
        return jsonb_build_object('ok', false, 'error', 'PROJECT_NOT_MAPPED_TO_CLIENT');
      end if;
    else
      select count(*) into v_count
        from agentsync.source_client_projects m
        join agentsync.projects p on p.id = m.project_id
       where m.source_client_id = v_client.id and p.enabled;
      if v_count = 0 then
        return jsonb_build_object('ok', false, 'error', 'CLIENT_NOT_MAPPED',
                                  'client', jsonb_build_object('id', v_client.external_id, 'name', v_client.name));
      elsif v_count > 1 then
        return jsonb_build_object('ok', false, 'error', 'ROUTING_REQUIRED',
                                  'candidates', agentsync.client_candidates(v_client.id));
      end if;
      select m.project_id into v_project
        from agentsync.source_client_projects m
        join agentsync.projects p on p.id = m.project_id
       where m.source_client_id = v_client.id and p.enabled;
    end if;
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
    'project_id', v_project,
    'project_name', (select name from agentsync.projects where id = v_project)
  );
end;
$$;

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
  if jsonb_typeof(payload->'clients') <> 'array' or jsonb_array_length(payload->'clients') > 5000 then
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
    'mapped', (select count(distinct c.id) from agentsync.source_clients c
                join agentsync.source_client_projects m on m.source_client_id = c.id
               where c.source_system_id = v_auth.source_system_id)
  );
end;
$$;

/* ---- portal ----------------------------------------------------------------- */

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
      select jsonb_agg(x.obj order by x.unmapped desc, lower(x.name))
        from (
          select c.name,
                 not exists (select 1 from agentsync.source_client_projects m where m.source_client_id = c.id) as unmapped,
                 jsonb_build_object(
                   'external_id', c.external_id,
                   'name', c.name,
                   'active', c.active,
                   'last_seen_at', c.last_seen_at,
                   'projects', coalesce((select jsonb_agg(jsonb_build_object('project_id', m.project_id, 'hint', m.hint)
                                                          order by m.created_at)
                                           from agentsync.source_client_projects m
                                          where m.source_client_id = c.id), '[]'::jsonb),
                   'task_count', (select count(*) from agentsync.agent_tasks t
                                   where t.source_system_id = c.source_system_id
                                     and t.requested_by->>'client_id' = c.external_id)
                 ) as obj
            from agentsync.source_clients c
           where c.source_system_id = p_source_id
        ) x
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

-- Kept until the new portal is deployed: the old screen maps a single repository.
create or replace function public.agentsync_portal_map_source_client(
  p_user_id uuid, p_tenant_slug text, p_source_id uuid, p_external_id text, p_project_id uuid
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  return public.agentsync_portal_set_client_projects(p_user_id, p_tenant_slug, p_source_id, p_external_id,
    case when p_project_id is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('project_id', p_project_id)) end);
end;
$$;

-- Replaces a client's repositories: p_projects = [{"project_id": "…", "hint": "…"}].

create or replace function public.agentsync_portal_set_client_projects(
  p_user_id uuid, p_tenant_slug text, p_source_id uuid, p_external_id text, p_projects jsonb
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_client uuid;
  v_item jsonb;
  v_project uuid;
begin
  v_tenant := agentsync.source_in_tenant(p_user_id, p_tenant_slug, p_source_id);
  if v_tenant is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  end if;
  if jsonb_typeof(p_projects) <> 'array' or jsonb_array_length(p_projects) > 20 then
    return jsonb_build_object('ok', false, 'error', 'VALIDATION_FAILED');
  end if;

  select c.id into v_client from agentsync.source_clients c
   where c.source_system_id = p_source_id and c.external_id = p_external_id;
  if v_client is null then
    return jsonb_build_object('ok', false, 'error', 'CLIENT_NOT_FOUND');
  end if;

  for v_item in select * from jsonb_array_elements(p_projects) loop
    v_project := nullif(v_item->>'project_id', '')::uuid;
    if v_project is null or not exists (select 1 from agentsync.projects p where p.id = v_project and p.tenant_id = v_tenant) then
      return jsonb_build_object('ok', false, 'error', 'PROJECT_NOT_FOUND');
    end if;
  end loop;

  delete from agentsync.source_client_projects m
   where m.source_client_id = v_client
     and m.project_id not in (select (e->>'project_id')::uuid from jsonb_array_elements(p_projects) e);

  insert into agentsync.source_client_projects (source_client_id, project_id, tenant_id, hint)
  select v_client, (e->>'project_id')::uuid, v_tenant, nullif(left(trim(coalesce(e->>'hint', '')), 300), '')
    from jsonb_array_elements(p_projects) e
  on conflict (source_client_id, project_id) do update set hint = excluded.hint;

  update agentsync.source_clients set updated_at = now() where id = v_client;
  return jsonb_build_object('ok', true);
end;
$$;

/* ---- the router's AI credentials for a source's tenant ---------------------- */

create or replace function public.agentsync_source_ai(payload jsonb)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select s.tenant_id into v_tenant from agentsync.source_systems s
   where s.api_key_prefix = left(payload->>'api_key', length(s.api_key_prefix))
     and s.api_key_hash = extensions.crypt(payload->>'api_key', s.api_key_hash)
     and s.state = 'ACTIVE';
  if v_tenant is null then return null; end if;
  return jsonb_build_object(
    'anthropic', (select to_jsonb(a) from agentsync.ai_provider_credentials a
                   where (a.tenant_id = v_tenant or a.tenant_id is null) and a.provider = 'anthropic'
                   order by a.tenant_id nulls last limit 1),
    'openai', (select to_jsonb(a) from agentsync.ai_provider_credentials a
                where (a.tenant_id = v_tenant or a.tenant_id is null) and a.provider = 'openai'
                order by a.tenant_id nulls last limit 1)
  );
end;
$$;

alter table agentsync.source_clients drop column project_id;

do $$
declare
  f text;
begin
  foreach f in array array[
    'agentsync.client_candidates(uuid)',
    'public.agentsync_submit_task(jsonb)',
    'public.agentsync_source_sync_clients(jsonb)',
    'public.agentsync_portal_source_clients(uuid, text, uuid)',
    'public.agentsync_portal_map_source_client(uuid, text, uuid, text, uuid)',
    'public.agentsync_portal_set_client_projects(uuid, text, uuid, text, jsonb)',
    'public.agentsync_source_ai(jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
