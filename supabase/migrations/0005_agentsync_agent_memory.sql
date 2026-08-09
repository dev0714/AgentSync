-- Agent memory.
--
-- Two sources, deliberately separated:
--
--   1. agentsync.file_edit_history() — DERIVED from task_file_changes and
--      agent_tasks. Every past edit to a path, with what the task was and how
--      the review went. Nothing is copied, so it cannot go stale or disagree
--      with the task record.
--
--   2. agentsync.memories — WRITTEN by an agent through the memory tool, or
--      pinned by a human. Conventions, lessons, failure fixes: judgement that
--      isn't derivable from the task record.
--
-- agentsync.recall() returns both for a set of paths, ready to be rendered
-- into a prompt.
--
-- Trust boundary: repository files and ticket text are untrusted input, so a
-- memory written by an agent is untrusted too. Memories are data the model
-- reads, never instructions it obeys, and they can never widen a permission or
-- raise a limit. Every row records where it came from.

create type agentsync.memory_kind as enum (
  'repo_fact',     -- where things live, how a module is wired
  'convention',    -- how this project does things
  'lesson',        -- learned from a rejection or a review
  'failure_fix',   -- an error signature and what resolved it
  'file_note'      -- something worth knowing about one path
);

create type agentsync.memory_source as enum ('agent', 'human', 'system');

create table agentsync.memories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references agentsync.tenants (id) on delete cascade,
  project_id uuid not null references agentsync.projects (id) on delete cascade,

  -- memory-tool path, always under /memories/
  path text not null,
  kind agentsync.memory_kind not null default 'repo_fact',
  -- repository path or glob this memory is about; null = project-wide
  scope_path text,
  content text not null,

  -- provenance: every row says where it came from
  source agentsync.memory_source not null default 'agent',
  source_task_id uuid references agentsync.agent_tasks (id) on delete set null,
  source_agent_key text,
  created_by uuid references agentsync.users (id) on delete set null,

  confidence numeric(3, 2) not null default 0.50
    check (confidence between 0 and 1),
  -- pinned memories are always recalled and never auto-superseded
  pinned boolean not null default false,
  superseded_by uuid references agentsync.memories (id) on delete set null,

  -- staleness: what the repository looked like when this was written
  valid_for_commit text,
  scope_checksum text,

  use_count integer not null default 0,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint memories_path_prefix check (path like '/memories/%'),
  unique (project_id, path)
);

create index memories_project_idx on agentsync.memories (project_id)
  where superseded_by is null;
create index memories_scope_idx on agentsync.memories (project_id, scope_path)
  where superseded_by is null;
create index memories_tenant_idx on agentsync.memories (tenant_id);

create trigger memories_touch_updated_at
  before update on agentsync.memories
  for each row execute function agentsync.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 1. derived edit history — "what happened to this file before"
-- ---------------------------------------------------------------------------

create or replace function agentsync.file_edit_history(
  p_project_id uuid,
  p_paths text[] default null,
  p_limit integer default 20
)
returns table (
  file_path text,
  action agentsync.file_action,
  additions integer,
  deletions integer,
  checksum_after text,
  task_ref text,
  task_title text,
  task_status agentsync.task_status,
  branch_name text,
  commit_sha text,
  review_verdict agentsync.review_verdict,
  plan_summary text,
  changed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    fc.file_path,
    fc.action,
    fc.additions,
    fc.deletions,
    fc.checksum_after,
    t.external_reference,
    t.title,
    t.status,
    t.branch_name,
    t.commit_sha,
    r.verdict,
    p.summary,
    fc.created_at
  from agentsync.task_file_changes fc
  join agentsync.agent_tasks t on t.id = fc.task_id
  left join agentsync.task_reviews r on r.task_id = t.id
  left join agentsync.task_plans p on p.task_id = t.id
    and p.version = (
      select max(p2.version) from agentsync.task_plans p2 where p2.task_id = t.id
    )
  where t.project_id = p_project_id
    and (p_paths is null or fc.file_path = any (p_paths))
    -- only edits that actually landed are worth remembering
    and t.status in ('completed', 'awaiting_merge_approval',
                     'awaiting_production_approval', 'deploying_production')
  order by fc.created_at desc
  limit p_limit;
$$;

comment on function agentsync.file_edit_history(uuid, text[], integer) is
  'Prior edits to the given paths, derived from the task record. Never stale.';

-- ---------------------------------------------------------------------------
-- 2. recall — memories + edit history for a set of paths
-- ---------------------------------------------------------------------------

create or replace function agentsync.recall(
  p_project_id uuid,
  p_paths text[] default null,
  p_kinds agentsync.memory_kind[] default null,
  p_limit integer default 25
)
returns table (
  id uuid,
  kind agentsync.memory_kind,
  path text,
  scope_path text,
  content text,
  source agentsync.memory_source,
  source_task_id uuid,
  confidence numeric,
  pinned boolean,
  stale boolean,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.id,
    m.kind,
    m.path,
    m.scope_path,
    m.content,
    m.source,
    m.source_task_id,
    m.confidence,
    m.pinned,
    -- a memory about a file that has changed since it was written is suspect
    (
      m.scope_checksum is not null
      and exists (
        select 1
        from agentsync.task_file_changes fc
        join agentsync.agent_tasks t on t.id = fc.task_id
        where t.project_id = m.project_id
          and fc.file_path = m.scope_path
          and fc.created_at > m.updated_at
          and fc.checksum_after is distinct from m.scope_checksum
      )
    ) as stale,
    m.created_at
  from agentsync.memories m
  where m.project_id = p_project_id
    and m.superseded_by is null
    and (p_kinds is null or m.kind = any (p_kinds))
    and (
      p_paths is null
      or m.scope_path is null                       -- project-wide
      or m.scope_path = any (p_paths)               -- exact path
      or exists (                                   -- glob: src/lib/**
        select 1 from unnest(p_paths) as q(path)
        where q.path like replace(replace(m.scope_path, '**', '%'), '*', '%')
      )
    )
  order by m.pinned desc, m.confidence desc, m.updated_at desc
  limit p_limit;
$$;

comment on function agentsync.recall(uuid, text[], agentsync.memory_kind[], integer) is
  'Memories relevant to the given paths, most trusted first. Marks entries whose file changed since writing as stale.';

-- Bump usage counters for the memories a run actually used, so unused
-- memories can be pruned later.
create or replace function agentsync.mark_memories_used(p_ids uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  update agentsync.memories
     set use_count = use_count + 1, last_used_at = now()
   where id = any (p_ids);
$$;

-- ---------------------------------------------------------------------------
-- 3. writing memory — supersede rather than overwrite
-- ---------------------------------------------------------------------------

-- Writing to an existing path supersedes the old row instead of destroying it,
-- so a bad memory can be traced and reverted.
create or replace function agentsync.remember(
  p_project_id uuid,
  p_path text,
  p_content text,
  p_kind agentsync.memory_kind default 'repo_fact',
  p_scope_path text default null,
  p_source agentsync.memory_source default 'agent',
  p_source_task_id uuid default null,
  p_source_agent_key text default null,
  p_confidence numeric default 0.50,
  p_valid_for_commit text default null,
  p_scope_checksum text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_existing uuid;
  v_new_id uuid;
begin
  select tenant_id into v_tenant_id
    from agentsync.projects where id = p_project_id;
  if v_tenant_id is null then
    raise exception 'no such project %', p_project_id;
  end if;

  if p_path not like '/memories/%' then
    raise exception 'memory path must start with /memories/ (got %)', p_path;
  end if;
  if position('..' in p_path) > 0 then
    raise exception 'memory path must not contain ".."';
  end if;

  select id into v_existing
    from agentsync.memories
   where project_id = p_project_id and path = p_path and superseded_by is null;

  insert into agentsync.memories (
    tenant_id, project_id, path, kind, scope_path, content,
    source, source_task_id, source_agent_key, confidence,
    valid_for_commit, scope_checksum
  ) values (
    v_tenant_id, p_project_id, p_path || case when v_existing is null then '' else '#' || gen_random_uuid()::text end,
    p_kind, p_scope_path, p_content,
    p_source, p_source_task_id, p_source_agent_key, p_confidence,
    p_valid_for_commit, p_scope_checksum
  ) returning id into v_new_id;

  if v_existing is not null then
    -- the new row takes the canonical path; the old one keeps a history path
    update agentsync.memories
       set path = p_path || '#' || v_existing::text,
           superseded_by = v_new_id
     where id = v_existing;
    update agentsync.memories set path = p_path where id = v_new_id;
  end if;

  return v_new_id;
end;
$$;

create or replace function agentsync.forget(p_project_id uuid, p_path text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with gone as (
    delete from agentsync.memories
     where project_id = p_project_id and path = p_path and superseded_by is null
    returning 1
  )
  select exists (select 1 from gone);
$$;

-- ---------------------------------------------------------------------------
-- row level security
-- ---------------------------------------------------------------------------

alter table agentsync.memories enable row level security;
alter table agentsync.memories force row level security;

create policy memories_select on agentsync.memories
  for select to authenticated
  using (agentsync.is_member(tenant_id));

-- Humans may pin, correct and delete; agents write via the service role.
create policy memories_write on agentsync.memories
  for all to authenticated
  using (agentsync.can_configure(tenant_id))
  with check (agentsync.can_configure(tenant_id));

grant select on agentsync.memories to authenticated;
grant insert, update, delete on agentsync.memories to authenticated;
grant select, insert, update, delete on agentsync.memories to service_role;

-- Recall is readable by the portal; writing is service-role only.
grant execute on function agentsync.recall(uuid, text[], agentsync.memory_kind[], integer) to authenticated, service_role;
grant execute on function agentsync.file_edit_history(uuid, text[], integer) to authenticated, service_role;

revoke all on function agentsync.remember(uuid, text, text, agentsync.memory_kind, text, agentsync.memory_source, uuid, text, numeric, text, text) from public, anon, authenticated;
revoke all on function agentsync.forget(uuid, text) from public, anon, authenticated;
revoke all on function agentsync.mark_memories_used(uuid[]) from public, anon, authenticated;
grant execute on function agentsync.remember(uuid, text, text, agentsync.memory_kind, text, agentsync.memory_source, uuid, text, numeric, text, text) to service_role;
grant execute on function agentsync.forget(uuid, text) to service_role;
grant execute on function agentsync.mark_memories_used(uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- public wrappers, service_role only (the agentsync schema is not exposed)
-- ---------------------------------------------------------------------------

create or replace function public.agentsync_recall(
  p_project_id uuid,
  p_paths text[] default null,
  p_limit integer default 25
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'memories', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.pinned desc, r.confidence desc)
      from agentsync.recall(p_project_id, p_paths, null, p_limit) r
    ), '[]'::jsonb),
    'edits', coalesce((
      select jsonb_agg(to_jsonb(h))
      from agentsync.file_edit_history(p_project_id, p_paths, p_limit) h
    ), '[]'::jsonb)
  );
$$;

create or replace function public.agentsync_remember(
  p_project_id uuid,
  p_path text,
  p_content text,
  p_kind text default 'repo_fact',
  p_scope_path text default null,
  p_source_task_id uuid default null,
  p_source_agent_key text default null,
  p_confidence numeric default 0.50,
  p_scope_checksum text default null
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select agentsync.remember(
    p_project_id, p_path, p_content, p_kind::agentsync.memory_kind, p_scope_path,
    'agent'::agentsync.memory_source, p_source_task_id, p_source_agent_key,
    p_confidence, null, p_scope_checksum
  );
$$;

create or replace function public.agentsync_forget(p_project_id uuid, p_path text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select agentsync.forget(p_project_id, p_path);
$$;

create or replace function public.agentsync_memory_list(
  p_project_id uuid,
  p_prefix text default '/memories/'
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'path', m.path, 'kind', m.kind, 'scope_path', m.scope_path,
    'content', m.content, 'pinned', m.pinned, 'updated_at', m.updated_at
  ) order by m.path), '[]'::jsonb)
  from agentsync.memories m
  where m.project_id = p_project_id
    and m.superseded_by is null
    and m.path like p_prefix || '%';
$$;

revoke all on function public.agentsync_recall(uuid, text[], integer) from public, anon, authenticated;
revoke all on function public.agentsync_remember(uuid, text, text, text, text, uuid, text, numeric, text) from public, anon, authenticated;
revoke all on function public.agentsync_forget(uuid, text) from public, anon, authenticated;
revoke all on function public.agentsync_memory_list(uuid, text) from public, anon, authenticated;

grant execute on function public.agentsync_recall(uuid, text[], integer) to service_role;
grant execute on function public.agentsync_remember(uuid, text, text, text, text, uuid, text, numeric, text) to service_role;
grant execute on function public.agentsync_forget(uuid, text) to service_role;
grant execute on function public.agentsync_memory_list(uuid, text) to service_role;
