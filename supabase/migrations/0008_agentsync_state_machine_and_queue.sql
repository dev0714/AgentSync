-- Phase 1: the state machine, the queue, and task submission.
--
-- Three things live here, all in the database rather than the worker, because
-- all three must hold when several workers race:
--
--   1. Legal state transitions are a table, not a CASE in application code.
--      transition_task() refuses an illegal move and writes the audit event in
--      the same transaction as the status change, so the log can never
--      disagree with the task.
--
--   2. claim_next_task() hands one queued task to exactly one worker using
--      FOR UPDATE SKIP LOCKED, and takes a lease. A worker that dies has its
--      task reclaimed rather than stranded.
--
--   3. submit_task() is idempotent on (tenant_id, idempotency_key): a retry
--      returns the original task instead of starting a second one.

create table agentsync.task_transitions (
  from_status agentsync.task_status not null,
  to_status agentsync.task_status not null,
  requires_human boolean not null default false,
  note text,
  primary key (from_status, to_status)
);

insert into agentsync.task_transitions (from_status, to_status, requires_human, note) values
  ('received',    'validating', false, 'payload and configuration checks'),
  ('validating',  'queued',     false, 'accepted, waiting for a worker'),
  ('validating',  'failed',     false, 'rejected at intake'),
  ('queued',      'analysing',  false, 'claimed by a worker'),
  ('analysing',   'planning',   false, null),
  ('planning',    'awaiting_plan_approval', false, 'project requires plan approval'),
  ('planning',    'implementing', false, 'plan approval not required'),
  ('awaiting_plan_approval', 'implementing', true,  'a human approved the plan'),
  ('awaiting_plan_approval', 'planning',     true,  'changes requested; re-plan'),
  ('awaiting_plan_approval', 'cancelled',    true,  'rejected by a human'),
  ('implementing', 'testing',   false, null),
  ('testing',      'implementing', false, 'validation failed; bounded repair'),
  ('testing',      'creating_pull_request', false, 'validation passed'),
  ('creating_pull_request', 'deploying_preview', false, null),
  ('creating_pull_request', 'awaiting_merge_approval', false, 'no preview configured'),
  ('deploying_preview', 'awaiting_merge_approval', false, null),
  ('awaiting_merge_approval', 'deploying_production', true, 'merge approved'),
  ('awaiting_merge_approval', 'completed', true, 'merged, no production deploy'),
  ('awaiting_merge_approval', 'implementing', true, 'changes requested'),
  ('awaiting_merge_approval', 'cancelled', true, 'rejected by a human'),
  ('deploying_production', 'awaiting_production_approval', false, 'production gate held'),
  ('awaiting_production_approval', 'deploying_production', true, 'production approved'),
  ('awaiting_production_approval', 'cancelled', true, 'rejected by a human'),
  ('deploying_production', 'completed', false, null),
  ('completed', 'rolled_back', true, 'human-initiated rollback');

insert into agentsync.task_transitions (from_status, to_status, requires_human, note)
select s, 'needs_information', false, 'agent raised questions'
from unnest(array['analysing','planning','implementing','testing']::agentsync.task_status[]) s;

insert into agentsync.task_transitions (from_status, to_status, requires_human, note)
select 'needs_information', s, true, 'answered by a human'
from unnest(array['planning','implementing']::agentsync.task_status[]) s;

insert into agentsync.task_transitions (from_status, to_status, requires_human, note)
select s, 'failed', false, 'unrecoverable error'
from unnest(array['analysing','planning','implementing','testing',
                  'creating_pull_request','deploying_preview',
                  'deploying_production']::agentsync.task_status[]) s;

insert into agentsync.task_transitions (from_status, to_status, requires_human, note)
select s, 'cancelled', true, 'cancelled by a human'
from unnest(array['received','validating','queued','analysing','planning',
                  'implementing','testing','needs_information']::agentsync.task_status[]) s
on conflict do nothing;

create or replace function agentsync.transition_allowed(
  p_from agentsync.task_status,
  p_to agentsync.task_status
)
returns boolean
language sql stable set search_path = ''
as $$
  select exists (
    select 1 from agentsync.task_transitions
     where from_status = p_from and to_status = p_to
  );
$$;

create or replace function agentsync.transition_task(
  p_task_id uuid,
  p_to agentsync.task_status,
  p_actor text default 'system',
  p_message text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_expected_worker text default null
)
returns agentsync.task_status
language plpgsql security definer set search_path = ''
as $$
declare
  v_task agentsync.agent_tasks;
begin
  select * into v_task from agentsync.agent_tasks where id = p_task_id for update;
  if not found then
    raise exception 'no such task %', p_task_id using errcode = 'P0002';
  end if;

  if p_expected_worker is not null and v_task.locked_by is distinct from p_expected_worker then
    raise exception 'task % is held by %, not %',
      p_task_id, coalesce(v_task.locked_by, '(nobody)'), p_expected_worker
      using errcode = '55006';
  end if;

  if v_task.status = p_to then
    return p_to;
  end if;

  if not agentsync.transition_allowed(v_task.status, p_to) then
    raise exception 'illegal transition % -> % for task %', v_task.status, p_to, p_task_id
      using errcode = '23514';
  end if;

  update agentsync.agent_tasks
     set status = p_to,
         completed_at = case when p_to in ('completed','failed','cancelled','rolled_back')
                             then now() else completed_at end,
         locked_by = case when p_to in ('completed','failed','cancelled','rolled_back')
                          then null else locked_by end,
         lock_expires_at = case when p_to in ('completed','failed','cancelled','rolled_back')
                                then null else lock_expires_at end
   where id = p_task_id;

  insert into agentsync.task_events (
    tenant_id, task_id, event_type, message, actor, correlation_id, metadata
  ) values (
    v_task.tenant_id, p_task_id, 'task.status_changed',
    coalesce(p_message, v_task.status::text || ' -> ' || p_to::text),
    p_actor, v_task.correlation_id,
    p_metadata || jsonb_build_object('from', v_task.status, 'to', p_to)
  );

  return p_to;
end;
$$;

create or replace function agentsync.submit_task(
  p_tenant_id uuid,
  p_project_id uuid,
  p_source_system_id uuid,
  p_idempotency_key text,
  p_title text,
  p_description text default null,
  p_external_reference text default null,
  p_request_type agentsync.request_type default 'code_change',
  p_priority agentsync.task_priority default 'normal',
  p_acceptance_criteria text[] default '{}',
  p_requested_by jsonb default null,
  p_callback_url text default null
)
returns table (task_id uuid, correlation_id uuid, status agentsync.task_status, created boolean)
language plpgsql security definer set search_path = ''
as $$
declare
  v_existing agentsync.agent_tasks;
  v_project agentsync.projects;
  v_id uuid;
  v_corr uuid;
begin
  select * into v_existing
    from agentsync.agent_tasks
   where tenant_id = p_tenant_id and idempotency_key = p_idempotency_key;
  if found then
    return query select v_existing.id, v_existing.correlation_id, v_existing.status, false;
    return;
  end if;

  select * into v_project from agentsync.projects where id = p_project_id;
  if not found or v_project.tenant_id <> p_tenant_id then
    raise exception 'project % does not belong to tenant %', p_project_id, p_tenant_id
      using errcode = '42501';
  end if;
  if not v_project.enabled then
    raise exception 'PROJECT_DISABLED' using errcode = '22023';
  end if;

  insert into agentsync.agent_tasks (
    tenant_id, project_id, source_system_id, idempotency_key, external_reference,
    request_type, priority, status, title, description, acceptance_criteria,
    requested_by, callback_url
  ) values (
    p_tenant_id, p_project_id, p_source_system_id, p_idempotency_key, p_external_reference,
    p_request_type, p_priority, 'received', p_title, p_description, p_acceptance_criteria,
    p_requested_by, coalesce(p_callback_url, v_project.callback_url)
  ) returning id, agent_tasks.correlation_id into v_id, v_corr;

  insert into agentsync.task_events (tenant_id, task_id, event_type, message, actor, correlation_id, metadata)
  values (p_tenant_id, v_id, 'task.received',
          'Accepted from source system - idempotency key new', 'api', v_corr,
          jsonb_build_object('idempotency_key', p_idempotency_key,
                             'request_type', p_request_type,
                             'priority', p_priority));

  perform agentsync.transition_task(v_id, 'validating', 'api', 'Payload and project configuration validated');
  perform agentsync.transition_task(v_id, 'queued', 'api', 'Enqueued at ' || p_priority || ' priority');

  return query select v_id, v_corr, 'queued'::agentsync.task_status, true;
end;
$$;

create or replace function agentsync.claim_next_task(
  p_worker_id text,
  p_lease_seconds integer default 1800,
  p_tenant_id uuid default null
)
returns table (
  task_id uuid, tenant_id uuid, project_id uuid, correlation_id uuid,
  title text, request_type agentsync.request_type,
  priority agentsync.task_priority, lock_expires_at timestamptz
)
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  select t.id into v_id
    from agentsync.agent_tasks t
    join agentsync.projects p on p.id = t.project_id
   where t.status = 'queued'
     and p.enabled
     and (p_tenant_id is null or t.tenant_id = p_tenant_id)
     and (
       select count(*) from agentsync.agent_tasks r
        where r.tenant_id = t.tenant_id and r.locked_by is not null
          and r.lock_expires_at > now()
     ) < coalesce(
       (select (settings->>'maximum_concurrent_tasks')::int
          from agentsync.tenants where id = t.tenant_id),
       1000000
     )
   order by
     case t.priority when 'urgent' then 0 when 'high' then 1
                     when 'normal' then 2 else 3 end,
     t.created_at
   for update of t skip locked
   limit 1;

  if v_id is null then
    return;
  end if;

  update agentsync.agent_tasks
     set locked_by = p_worker_id,
         lock_expires_at = now() + make_interval(secs => p_lease_seconds)
   where id = v_id;

  perform agentsync.transition_task(
    v_id, 'analysing', p_worker_id,
    'Worker ' || p_worker_id || ' acquired lock',
    jsonb_build_object('worker_id', p_worker_id, 'lease_seconds', p_lease_seconds)
  );

  return query
    select t.id, t.tenant_id, t.project_id, t.correlation_id, t.title,
           t.request_type, t.priority, t.lock_expires_at
      from agentsync.agent_tasks t where t.id = v_id;
end;
$$;

create or replace function agentsync.heartbeat_task(
  p_task_id uuid, p_worker_id text, p_lease_seconds integer default 1800
)
returns boolean
language sql security definer set search_path = ''
as $$
  with bumped as (
    update agentsync.agent_tasks
       set lock_expires_at = now() + make_interval(secs => p_lease_seconds)
     where id = p_task_id and locked_by = p_worker_id
    returning 1
  )
  select exists (select 1 from bumped);
$$;

create or replace function agentsync.reclaim_expired_tasks()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_task record;
  v_count integer := 0;
begin
  for v_task in
    select id, tenant_id, correlation_id, locked_by, status
      from agentsync.agent_tasks
     where locked_by is not null
       and lock_expires_at < now()
       and status not in ('completed','failed','cancelled','rolled_back')
     for update skip locked
  loop
    update agentsync.agent_tasks
       set locked_by = null, lock_expires_at = null, status = 'queued'
     where id = v_task.id;

    insert into agentsync.task_events (tenant_id, task_id, event_type, message, actor, correlation_id, metadata)
    values (v_task.tenant_id, v_task.id, 'worker.lease_expired',
            'Lease expired while ' || v_task.status || '; returned to the queue',
            v_task.locked_by, v_task.correlation_id,
            jsonb_build_object('reclaimed_from', v_task.status));

    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create index agent_tasks_lock_idx on agentsync.agent_tasks (lock_expires_at)
  where locked_by is not null;

alter table agentsync.task_transitions enable row level security;
create policy task_transitions_select on agentsync.task_transitions
  for select to authenticated using (true);
grant select on agentsync.task_transitions to authenticated, service_role;

revoke all on function agentsync.transition_task(uuid, agentsync.task_status, text, text, jsonb, text) from public, anon, authenticated;
revoke all on function agentsync.submit_task(uuid, uuid, uuid, text, text, text, text, agentsync.request_type, agentsync.task_priority, text[], jsonb, text) from public, anon, authenticated;
revoke all on function agentsync.claim_next_task(text, integer, uuid) from public, anon, authenticated;
revoke all on function agentsync.heartbeat_task(uuid, text, integer) from public, anon, authenticated;
revoke all on function agentsync.reclaim_expired_tasks() from public, anon, authenticated;

grant execute on function agentsync.transition_task(uuid, agentsync.task_status, text, text, jsonb, text) to service_role;
grant execute on function agentsync.submit_task(uuid, uuid, uuid, text, text, text, text, agentsync.request_type, agentsync.task_priority, text[], jsonb, text) to service_role;
grant execute on function agentsync.claim_next_task(text, integer, uuid) to service_role;
grant execute on function agentsync.heartbeat_task(uuid, text, integer) to service_role;
grant execute on function agentsync.reclaim_expired_tasks() to service_role;
grant execute on function agentsync.transition_allowed(agentsync.task_status, agentsync.task_status) to authenticated, service_role;
