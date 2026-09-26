-- Every project has a description file in its repository, AGENTSYNC.md, and
-- AgentSync keeps every version of it: who or which task changed it, when,
-- and the text, so any version can be compared or restored. Changes reach the
-- repository by pull request.
--
-- Every project also has a release version. Each AgentSync pull request
-- reserves the next version and adds a CHANGELOG.md entry; the merge releases
-- it and tags the merge commit vX.Y.Z.

create table agentsync.project_documents (
  project_id uuid primary key references agentsync.projects (id) on delete cascade,
  tenant_id uuid not null references agentsync.tenants (id) on delete cascade,
  path text not null default 'AGENTSYNC.md',
  current_version integer not null default 0,
  -- in_sync: the default branch has the current version; pr_open: it's waiting
  -- in a pull request; missing: not in the repository and no PR yet.
  repo_state text not null default 'unknown'
    check (repo_state in ('unknown', 'missing', 'pr_open', 'in_sync')),
  repo_blob_sha text,
  pr_number integer,
  pr_url text,
  checked_at timestamptz,
  updated_at timestamptz not null default now()
);

create table agentsync.project_document_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references agentsync.projects (id) on delete cascade,
  tenant_id uuid not null references agentsync.tenants (id) on delete cascade,
  version integer not null,
  content text not null check (length(content) <= 200000),
  -- repository: read from the repo; import: copied from the README;
  -- agent: written by an AgentSync task; person: edited in AgentSync;
  -- restore: an earlier version brought back.
  source text not null check (source in ('repository', 'import', 'agent', 'person', 'restore')),
  author_user_id uuid,
  author_name text,
  task_id uuid references agentsync.agent_tasks (id) on delete set null,
  note text,
  repo_commit_sha text,
  created_at timestamptz not null default now(),
  unique (project_id, version)
);

alter table agentsync.projects add column if not exists release_version text;

create table agentsync.project_releases (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references agentsync.projects (id) on delete cascade,
  tenant_id uuid not null references agentsync.tenants (id) on delete cascade,
  task_id uuid unique references agentsync.agent_tasks (id) on delete set null,
  version text not null,
  bump text not null check (bump in ('major', 'minor', 'patch')),
  status text not null default 'reserved' check (status in ('reserved', 'released', 'abandoned')),
  title text,
  notes text,
  commit_sha text,
  tag text,
  pr_url text,
  created_at timestamptz not null default now(),
  released_at timestamptz
);

create index project_releases_project_idx on agentsync.project_releases (project_id, created_at desc);

alter table agentsync.project_documents enable row level security;
alter table agentsync.project_document_versions enable row level security;
alter table agentsync.project_releases enable row level security;

/* ---- semantic versions ---------------------------------------------------- */

create or replace function agentsync.semver_parts(p text)
returns int[]
language sql immutable set search_path = ''
as $$
  select case when p ~ '^v?\d+\.\d+\.\d+'
    then array[
      (regexp_match(p, '^v?(\d+)\.(\d+)\.(\d+)'))[1]::int,
      (regexp_match(p, '^v?(\d+)\.(\d+)\.(\d+)'))[2]::int,
      (regexp_match(p, '^v?(\d+)\.(\d+)\.(\d+)'))[3]::int]
    else array[0, 0, 0] end;
$$;

create or replace function agentsync.semver_bump(p text, p_bump text)
returns text
language sql immutable set search_path = ''
as $$
  select case p_bump
    when 'major' then (v[1] + 1) || '.0.0'
    when 'minor' then v[1] || '.' || (v[2] + 1) || '.0'
    else v[1] || '.' || v[2] || '.' || (v[3] + 1) end
  from (select agentsync.semver_parts(p) as v) x;
$$;

/* ---- context for the GitHub side of a project ----------------------------- */

create or replace function public.agentsync_project_context(p_project_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'project', to_jsonb(p),
    'repository', (select to_jsonb(r) from agentsync.project_repositories r
                    where r.project_id = p.id order by r.created_at limit 1),
    'github', (select to_jsonb(g) from agentsync.github_app_installations g
                where g.tenant_id = p.tenant_id order by g.created_at limit 1),
    'document', (select to_jsonb(d) from agentsync.project_documents d where d.project_id = p.id),
    'current', (select v.content from agentsync.project_document_versions v
                 join agentsync.project_documents d on d.project_id = v.project_id and d.current_version = v.version
                where v.project_id = p.id)
  )
  from agentsync.projects p where p.id = p_project_id;
$$;

-- The projects of a tenant this user may configure, for bulk import.
create or replace function public.agentsync_portal_configurable_projects(p_user_id uuid, p_tenant_slug text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  v_tenant := agentsync.configurable_tenant(p_user_id, p_tenant_slug);
  if v_tenant is null then return null; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name,
      'repo_state', coalesce(d.repo_state, 'unknown'),
      'current_version', coalesce(d.current_version, 0)) order by lower(p.name))
    from agentsync.projects p
    left join agentsync.project_documents d on d.project_id = p.id
   where p.tenant_id = v_tenant and p.enabled), '[]'::jsonb);
end;
$$;

create or replace function public.agentsync_portal_project_access(p_user_id uuid, p_tenant_slug text, p_project_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from agentsync.projects p
     where p.id = p_project_id
       and p.tenant_id = agentsync.configurable_tenant(p_user_id, p_tenant_slug));
$$;

/* ---- description versions ------------------------------------------------- */

-- Adds a version unless the text equals the current one. Returns the current
-- version number either way, and whether a new one was made.
create or replace function public.agentsync_doc_add_version(
  p_project_id uuid, p_content text, p_source text,
  p_author_user_id uuid default null, p_author_name text default null,
  p_task_id uuid default null, p_note text default null, p_repo_commit_sha text default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_doc agentsync.project_documents;
  v_current text;
  v_next integer;
begin
  select p.tenant_id into v_tenant from agentsync.projects p where p.id = p_project_id;
  if v_tenant is null then return jsonb_build_object('ok', false, 'error', 'PROJECT_NOT_FOUND'); end if;

  insert into agentsync.project_documents (project_id, tenant_id) values (p_project_id, v_tenant)
  on conflict (project_id) do nothing;
  select * into v_doc from agentsync.project_documents where project_id = p_project_id for update;

  select v.content into v_current from agentsync.project_document_versions v
   where v.project_id = p_project_id and v.version = v_doc.current_version;
  if v_current is not null and v_current = p_content then
    return jsonb_build_object('ok', true, 'version', v_doc.current_version, 'created', false);
  end if;

  v_next := v_doc.current_version + 1;
  insert into agentsync.project_document_versions
    (project_id, tenant_id, version, content, source, author_user_id, author_name, task_id, note, repo_commit_sha)
  values
    (p_project_id, v_tenant, v_next, p_content, p_source, p_author_user_id,
     coalesce(p_author_name, (select u.display_name from agentsync.users u where u.id = p_author_user_id)),
     p_task_id, left(p_note, 500), p_repo_commit_sha);
  update agentsync.project_documents set current_version = v_next, updated_at = now() where project_id = p_project_id;
  return jsonb_build_object('ok', true, 'version', v_next, 'created', true);
end;
$$;

create or replace function public.agentsync_doc_set_repo(p_project_id uuid, p_fields jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  insert into agentsync.project_documents (project_id, tenant_id)
  select p.id, p.tenant_id from agentsync.projects p where p.id = p_project_id
  on conflict (project_id) do nothing;
  update agentsync.project_documents set
    repo_state = coalesce(p_fields->>'repo_state', repo_state),
    repo_blob_sha = case when p_fields ? 'repo_blob_sha' then p_fields->>'repo_blob_sha' else repo_blob_sha end,
    pr_number = case when p_fields ? 'pr_number' then (p_fields->>'pr_number')::int else pr_number end,
    pr_url = case when p_fields ? 'pr_url' then p_fields->>'pr_url' else pr_url end,
    checked_at = now(),
    updated_at = now()
  where project_id = p_project_id;
  if p_fields ? 'release_version' then
    update agentsync.projects set release_version = p_fields->>'release_version'
     where id = p_project_id and release_version is null;
  end if;
end;
$$;

-- What the portal shows for a project: the description and its history.
create or replace function public.agentsync_portal_project_doc(p_user_id uuid, p_tenant_slug text, p_project_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.agentsync_portal_project_access(p_user_id, p_tenant_slug, p_project_id) then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  end if;
  return jsonb_build_object(
    'ok', true,
    'document', (select to_jsonb(d) from agentsync.project_documents d where d.project_id = p_project_id),
    'current', (select to_jsonb(v) from agentsync.project_document_versions v
                  join agentsync.project_documents d on d.project_id = v.project_id and d.current_version = v.version
                 where v.project_id = p_project_id),
    'versions', coalesce((select jsonb_agg(jsonb_build_object(
        'version', v.version, 'source', v.source, 'author_name', v.author_name, 'task_id', v.task_id,
        'task_title', (select t.title from agentsync.agent_tasks t where t.id = v.task_id),
        'note', v.note, 'created_at', v.created_at, 'length', length(v.content)) order by v.version desc)
      from (select * from agentsync.project_document_versions
             where project_id = p_project_id order by version desc limit 100) v), '[]'::jsonb),
    'release_version', (select p.release_version from agentsync.projects p where p.id = p_project_id),
    'releases', coalesce((select jsonb_agg(jsonb_build_object(
        'version', r.version, 'bump', r.bump, 'status', r.status, 'title', r.title, 'notes', r.notes,
        'tag', r.tag, 'commit_sha', r.commit_sha, 'pr_url', r.pr_url, 'task_id', r.task_id,
        'created_at', r.created_at, 'released_at', r.released_at) order by r.created_at desc)
      from (select * from agentsync.project_releases
             where project_id = p_project_id and status <> 'abandoned' order by created_at desc limit 100) r), '[]'::jsonb)
  );
end;
$$;

create or replace function public.agentsync_portal_doc_version(p_user_id uuid, p_tenant_slug text, p_project_id uuid, p_version integer)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.agentsync_portal_project_access(p_user_id, p_tenant_slug, p_project_id) then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  end if;
  return jsonb_build_object('ok', true, 'version', (
    select to_jsonb(v) from agentsync.project_document_versions v
     where v.project_id = p_project_id and v.version = p_version));
end;
$$;

/* ---- releases ------------------------------------------------------------- */

-- Reserves the next version for a task's pull request. Idempotent per task.
create or replace function public.agentsync_release_reserve(p_task_id uuid, p_bump text, p_title text, p_notes text, p_pr_url text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_task agentsync.agent_tasks;
  v_existing agentsync.project_releases;
  v_base text;
  v_version text;
  v_bump text := case when p_bump in ('major', 'minor', 'patch') then p_bump else 'patch' end;
begin
  select * into v_task from agentsync.agent_tasks where id = p_task_id;
  if v_task.id is null then return jsonb_build_object('ok', false, 'error', 'NO_SUCH_TASK'); end if;

  select * into v_existing from agentsync.project_releases where task_id = p_task_id;
  if v_existing.id is not null and v_existing.status <> 'abandoned' then
    update agentsync.project_releases set title = left(p_title, 300), notes = left(p_notes, 20000), pr_url = p_pr_url
     where id = v_existing.id;
    return jsonb_build_object('ok', true, 'version', v_existing.version);
  end if;

  perform 1 from agentsync.projects where id = v_task.project_id for update;

  -- The highest (by number, not text) of the released version and any version
  -- already reserved by another open pull request.
  select x.v into v_base from (
    select p.release_version as v from agentsync.projects p where p.id = v_task.project_id and p.release_version is not null
    union all
    select r.version from agentsync.project_releases r
     where r.project_id = v_task.project_id and r.status in ('reserved', 'released')
  ) x order by agentsync.semver_parts(x.v) desc limit 1;

  v_version := agentsync.semver_bump(coalesce(v_base, '0.0.0'), v_bump);

  if v_existing.id is not null then
    update agentsync.project_releases set version = v_version, bump = v_bump, status = 'reserved',
      title = left(p_title, 300), notes = left(p_notes, 20000), pr_url = p_pr_url, created_at = now()
     where id = v_existing.id;
  else
    insert into agentsync.project_releases (project_id, tenant_id, task_id, version, bump, title, notes, pr_url)
    values (v_task.project_id, v_task.tenant_id, p_task_id, v_version, v_bump, left(p_title, 300), left(p_notes, 20000), p_pr_url);
  end if;
  return jsonb_build_object('ok', true, 'version', v_version);
end;
$$;

create or replace function public.agentsync_release_finish(p_task_id uuid, p_commit_sha text, p_tag text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_rel agentsync.project_releases;
begin
  update agentsync.project_releases
     set status = 'released', commit_sha = p_commit_sha, tag = p_tag, released_at = now()
   where task_id = p_task_id and status = 'reserved'
  returning * into v_rel;
  if v_rel.id is null then return jsonb_build_object('ok', false); end if;
  update agentsync.projects p set release_version = v_rel.version
   where p.id = v_rel.project_id
     and (p.release_version is null or agentsync.semver_parts(v_rel.version) > agentsync.semver_parts(p.release_version));
  return jsonb_build_object('ok', true, 'version', v_rel.version);
end;
$$;

create or replace function public.agentsync_release_abandon(p_task_id uuid)
returns void
language sql security definer set search_path = ''
as $$
  update agentsync.project_releases set status = 'abandoned' where task_id = p_task_id and status = 'reserved';
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.agentsync_project_context(uuid)',
    'public.agentsync_portal_configurable_projects(uuid, text)',
    'public.agentsync_portal_project_access(uuid, text, uuid)',
    'public.agentsync_doc_add_version(uuid, text, text, uuid, text, uuid, text, text)',
    'public.agentsync_doc_set_repo(uuid, jsonb)',
    'public.agentsync_portal_project_doc(uuid, text, uuid)',
    'public.agentsync_portal_doc_version(uuid, text, uuid, integer)',
    'public.agentsync_release_reserve(uuid, text, text, text, text)',
    'public.agentsync_release_finish(uuid, text, text)',
    'public.agentsync_release_abandon(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
