-- Staleness was decided by comparing timestamps (file changed after the memory
-- was written). That depends on clock ordering and misses an edit that lands in
-- the same instant as the write. Compare the memory's recorded checksum against
-- the newest landed checksum for that path instead — no clock involved.
--
-- Superseded in 0007, which replaces the "newest landed checksum" lookup with a
-- deterministic ordering. Kept as applied for history.

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
    order by fc.created_at desc
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

grant execute on function agentsync.recall(uuid, text[], agentsync.memory_kind[], integer) to authenticated, service_role;
