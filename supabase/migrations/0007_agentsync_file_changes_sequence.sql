-- "The newest change to this file" was decided by created_at, but a worker
-- writes every file change for a task in one transaction, so those rows share
-- a timestamp and the ordering among them was arbitrary. A monotonic sequence
-- gives a deterministic total order that no clock tie can break.

alter table agentsync.task_file_changes
  add column seq bigint generated always as identity;

create index task_file_changes_path_seq_idx
  on agentsync.task_file_changes (file_path, seq desc);

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
    m.id, m.kind, m.path, m.scope_path, m.content,
    m.source, m.source_task_id, m.confidence, m.pinned,
    (
      m.scope_checksum is not null
      and latest.checksum_after is not null
      and latest.checksum_after <> m.scope_checksum
    ) as stale,
    m.created_at
  from agentsync.memories m
  left join lateral (
    select fc.checksum_after
    from agentsync.task_file_changes fc
    join agentsync.agent_tasks t on t.id = fc.task_id
    where t.project_id = m.project_id
      and fc.file_path = m.scope_path
      and fc.checksum_after is not null
      and t.status in ('completed', 'awaiting_merge_approval',
                       'awaiting_production_approval', 'deploying_production')
    order by fc.seq desc          -- deterministic; no clock involved
    limit 1
  ) latest on true
  where m.project_id = p_project_id
    and m.superseded_by is null
    and (p_kinds is null or m.kind = any (p_kinds))
    and (
      p_paths is null
      or m.scope_path is null
      or m.scope_path = any (p_paths)
      or exists (
        select 1 from unnest(p_paths) as q(path)
        where q.path like replace(replace(m.scope_path, '**', '%'), '*', '%')
      )
    )
  order by m.pinned desc, m.confidence desc, m.updated_at desc
  limit p_limit;
$$;

-- Order history by the same sequence so "most recent edit" is stable too.
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
    fc.file_path, fc.action, fc.additions, fc.deletions, fc.checksum_after,
    t.external_reference, t.title, t.status, t.branch_name, t.commit_sha,
    r.verdict, p.summary, fc.created_at
  from agentsync.task_file_changes fc
  join agentsync.agent_tasks t on t.id = fc.task_id
  left join agentsync.task_reviews r on r.task_id = t.id
  left join agentsync.task_plans p on p.task_id = t.id
    and p.version = (
      select max(p2.version) from agentsync.task_plans p2 where p2.task_id = t.id
    )
  where t.project_id = p_project_id
    and (p_paths is null or fc.file_path = any (p_paths))
    and t.status in ('completed', 'awaiting_merge_approval',
                     'awaiting_production_approval', 'deploying_production')
  order by fc.seq desc
  limit p_limit;
$$;

grant execute on function agentsync.recall(uuid, text[], agentsync.memory_kind[], integer) to authenticated, service_role;
grant execute on function agentsync.file_edit_history(uuid, text[], integer) to authenticated, service_role;
