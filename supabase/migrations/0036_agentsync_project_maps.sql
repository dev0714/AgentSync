-- A map of each project's code, made with Graphify (graphifyy, code-only:
-- tree-sitter parsing, no AI model) in a Vercel Sandbox. The outputs —
-- graph.json, graph.html, GRAPH_REPORT.md — and Graphify's cache (for the
-- next, incremental run) are kept in the private project-maps bucket.

insert into storage.buckets (id, name, public, file_size_limit)
values ('project-maps', 'project-maps', false, 104857600)
on conflict (id) do nothing;

create table agentsync.project_maps (
  project_id uuid primary key references agentsync.projects (id) on delete cascade,
  tenant_id uuid not null references agentsync.tenants (id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'ready', 'failed')),
  -- why this run: import, merge (with the task), person
  reason text,
  task_id uuid references agentsync.agent_tasks (id) on delete set null,
  sandbox_name text,
  started_at timestamptz,
  finished_at timestamptz,
  -- the commit the ready map describes, and the previous ready map's details
  -- stay in place while a new run is going
  commit_sha text,
  mapped_at timestamptz,
  graphify_version text,
  stats jsonb,
  files jsonb,
  error text,
  attempts integer not null default 0,
  -- asked for again while a run was going: run once more when it finishes
  rerun boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table agentsync.project_maps enable row level security;

create or replace function public.agentsync_map_queue(p_project_id uuid, p_reason text, p_task_id uuid default null)
returns void
language sql security definer set search_path = ''
as $$
  insert into agentsync.project_maps (project_id, tenant_id, status, reason, task_id)
  select p.id, p.tenant_id, 'queued', p_reason, p_task_id from agentsync.projects p where p.id = p_project_id
  on conflict (project_id) do update
    set status = case when agentsync.project_maps.status = 'running' then 'running' else 'queued' end,
        reason = excluded.reason,
        task_id = excluded.task_id,
        attempts = case when agentsync.project_maps.status = 'running' then agentsync.project_maps.attempts else 0 end,
        -- a run already going is followed by another when it finishes
        rerun = agentsync.project_maps.status = 'running',
        error = null,
        updated_at = now();
$$;

-- The runs the worker should look at: every running one, then queued ones up
-- to p_start_limit (the concurrency cap).
create or replace function public.agentsync_map_work(p_start_limit integer)
returns jsonb
language sql security definer set search_path = ''
as $$
  select jsonb_build_object(
    'running', coalesce((select jsonb_agg(to_jsonb(m)) from agentsync.project_maps m where m.status = 'running'), '[]'::jsonb),
    'queued', coalesce((select jsonb_agg(to_jsonb(x)) from (
        select m.* from agentsync.project_maps m
          join agentsync.projects p on p.id = m.project_id and p.enabled
         where m.status = 'queued'
         order by m.updated_at
         limit greatest(0, p_start_limit - (select count(*) from agentsync.project_maps r where r.status = 'running'))
      ) x), '[]'::jsonb)
  );
$$;

-- Claims a queued run for starting (so two ticks never start the same one).
create or replace function public.agentsync_map_claim(p_project_id uuid, p_sandbox_name text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  update agentsync.project_maps
     set status = 'running', sandbox_name = p_sandbox_name, started_at = now(), attempts = attempts + 1,
         error = null, updated_at = now()
   where project_id = p_project_id and status = 'queued';
  return found;
end;
$$;

create or replace function public.agentsync_map_update(p_project_id uuid, p_fields jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update agentsync.project_maps set
    status = coalesce(p_fields->>'status', status),
    finished_at = case when p_fields ? 'finished_at' then (p_fields->>'finished_at')::timestamptz else finished_at end,
    commit_sha = case when p_fields ? 'commit_sha' then p_fields->>'commit_sha' else commit_sha end,
    mapped_at = case when p_fields ? 'mapped_at' then (p_fields->>'mapped_at')::timestamptz else mapped_at end,
    graphify_version = case when p_fields ? 'graphify_version' then p_fields->>'graphify_version' else graphify_version end,
    stats = case when p_fields ? 'stats' then p_fields->'stats' else stats end,
    files = case when p_fields ? 'files' then p_fields->'files' else files end,
    error = case when p_fields ? 'error' then p_fields->>'error' else error end,
    sandbox_name = case when p_fields ? 'sandbox_name' then p_fields->>'sandbox_name' else sandbox_name end,
    rerun = case when p_fields ? 'rerun' then (p_fields->>'rerun')::boolean else rerun end,
    updated_at = now()
  where project_id = p_project_id;
end;
$$;

create or replace function public.agentsync_map_get(p_project_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select to_jsonb(m) from agentsync.project_maps m where m.project_id = p_project_id;
$$;

create or replace function public.agentsync_portal_project_map(p_user_id uuid, p_tenant_slug text, p_project_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.agentsync_portal_project_access(p_user_id, p_tenant_slug, p_project_id) then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  end if;
  return jsonb_build_object('ok', true, 'map',
    (select to_jsonb(m) - 'sandbox_name' from agentsync.project_maps m where m.project_id = p_project_id));
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.agentsync_map_queue(uuid, text, uuid)',
    'public.agentsync_map_work(integer)',
    'public.agentsync_map_claim(uuid, text)',
    'public.agentsync_map_update(uuid, jsonb)',
    'public.agentsync_map_get(uuid)',
    'public.agentsync_portal_project_map(uuid, text, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
