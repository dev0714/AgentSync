-- A change's SQL is tried on the linked database before review: run and
-- rolled back, so the Engineer can fix a script that would not apply before a
-- person ever sees it. The result is kept per script, and goes stale (back to
-- untested) whenever the script changes.

alter table agentsync.task_db_changes
  add column if not exists dry_run_status text check (dry_run_status in ('passed', 'failed', 'skipped')),
  add column if not exists dry_run_output text,
  add column if not exists dry_run_at timestamptz;

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
      applied_at = case when d.blob_sha is distinct from excluded.blob_sha then null else d.applied_at end,
      dry_run_status = case when d.blob_sha is distinct from excluded.blob_sha then null else d.dry_run_status end,
      dry_run_output = case when d.blob_sha is distinct from excluded.blob_sha then null else d.dry_run_output end,
      dry_run_at = case when d.blob_sha is distinct from excluded.blob_sha then null else d.dry_run_at end;
  end loop;
end;
$$;

create or replace function public.agentsync_db_changes_for(p_task_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id, 'path', d.path, 'blob_sha', d.blob_sha, 'status', d.status,
    'applied_by_email', d.applied_by_email, 'applied_at', d.applied_at, 'output', d.output,
    'dry_run_status', d.dry_run_status, 'dry_run_output', d.dry_run_output, 'dry_run_at', d.dry_run_at) order by d.path), '[]'::jsonb)
    from agentsync.task_db_changes d where d.task_id = p_task_id;
$$;

-- The worker records a test run (never a person: nothing was applied).
create or replace function public.agentsync_db_change_dry_run(p_change_id uuid, p_status text, p_output text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_change agentsync.task_db_changes;
begin
  if p_status not in ('passed', 'failed', 'skipped') then
    raise exception 'bad dry run status %', p_status;
  end if;
  update agentsync.task_db_changes
     set dry_run_status = p_status, dry_run_output = left(p_output, 4000), dry_run_at = now()
   where id = p_change_id
  returning * into v_change;
  if not found then return; end if;
  insert into agentsync.task_events (tenant_id, task_id, event_type, message, actor, correlation_id, metadata)
  select t.tenant_id, t.id, 'db.dry_run',
         case p_status
           when 'passed' then 'Tried ' || v_change.path || ' on the database and rolled it back: it applies cleanly'
           when 'failed' then 'Tried ' || v_change.path || ' on the database: it would fail — ' || left(coalesce(p_output, ''), 300)
           else v_change.path || ' ' || coalesce(p_output, 'was not tested') end,
         'worker', t.correlation_id, jsonb_build_object('path', v_change.path, 'status', p_status)
    from agentsync.agent_tasks t where t.id = v_change.task_id;
end;
$$;

revoke all on function public.agentsync_db_change_dry_run(uuid, text, text) from public, anon, authenticated;
grant execute on function public.agentsync_db_change_dry_run(uuid, text, text) to service_role;
