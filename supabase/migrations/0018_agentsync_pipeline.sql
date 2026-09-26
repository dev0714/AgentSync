-- The pipeline, made real.
--
-- 0008 built a queue that could only start work: the claim took `queued`
-- tasks and nothing else, so a task could never be picked up again once it had
-- moved on. This migration lets a worker resume a task in whatever working
-- state it was left in, gives the stages somewhere to write what they did, and
-- puts every human decision behind one function that checks who is deciding.
--
-- Human-only transitions (the `requires_human` rows in task_transitions) are
-- now enforced: transition_task refuses them unless the caller is
-- decide_approval, which sets a transaction-local flag after checking the
-- user's role. A worker running as the service role cannot approve its own
-- work by calling transition_task directly.

/* ---- task columns the worker needs ------------------------------------ */

alter table agentsync.agent_tasks
  add column if not exists stage_state jsonb not null default '{}'::jsonb,
  add column if not exists repair_attempts integer not null default 0,
  add column if not exists next_attempt_at timestamptz;

comment on column agentsync.agent_tasks.stage_state is
  'Working data carried between stages: repository context, reviewer feedback, the commit awaiting checks. Never holds secrets.';
comment on column agentsync.agent_tasks.next_attempt_at is
  'A worker will not claim the task before this time. Set while waiting on external checks.';

-- Review comes after checks, inside `testing`; a clean review goes on to the
-- pull request. Merge approval moves to deploying_production, whose stage
-- merges the pull request and completes the task.
insert into agentsync.task_transitions (from_status, to_status, requires_human, note) values
  ('testing', 'failed', false, 'checks or review failed beyond the repair limit')
on conflict do nothing;

/* ---- transition_task: enforce human gates, open approval rows ---------- */

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
  v_human boolean;
  v_gate agentsync.approval_gate;
  v_terminal boolean := p_to in ('completed','failed','cancelled','rolled_back');
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

  select requires_human into v_human
    from agentsync.task_transitions
   where from_status = v_task.status and to_status = p_to;
  if not found then
    raise exception 'illegal transition % -> % for task %', v_task.status, p_to, p_task_id
      using errcode = '23514';
  end if;

  if v_human and coalesce(current_setting('agentsync.human_decision', true), '') <> 'on' then
    raise exception 'transition % -> % needs a human decision', v_task.status, p_to
      using errcode = '42501';
  end if;

  update agentsync.agent_tasks
     set status = p_to,
         completed_at = case when v_terminal then now() else completed_at end,
         locked_by = case when v_terminal then null else locked_by end,
         lock_expires_at = case when v_terminal then null else lock_expires_at end,
         next_attempt_at = case when v_terminal then null else next_attempt_at end,
         progress_percent = case p_to
           when 'analysing' then 10 when 'planning' then 20
           when 'awaiting_plan_approval' then 30 when 'implementing' then 45
           when 'testing' then 65 when 'creating_pull_request' then 80
           when 'awaiting_merge_approval' then 85 when 'deploying_production' then 95
           when 'completed' then 100 else progress_percent end
   where id = p_task_id;

  insert into agentsync.task_events (
    tenant_id, task_id, event_type, message, actor, correlation_id, metadata
  ) values (
    v_task.tenant_id, p_task_id, 'task.status_changed',
    coalesce(p_message, v_task.status::text || ' -> ' || p_to::text),
    p_actor, v_task.correlation_id,
    p_metadata || jsonb_build_object('from', v_task.status, 'to', p_to)
  );

  -- Entering a gate opens its approval row, so the approvals queue and the
  -- task agree about what is waiting without a second call to forget.
  v_gate := case p_to
    when 'awaiting_plan_approval' then 'plan'
    when 'awaiting_merge_approval' then 'merge'
    when 'awaiting_production_approval' then 'production'
    else null end;
  if v_gate is not null and not exists (
    select 1 from agentsync.task_approvals
     where task_id = p_task_id and gate = v_gate and decision = 'pending'
  ) then
    insert into agentsync.task_approvals (tenant_id, task_id, gate, decision)
    values (v_task.tenant_id, p_task_id, v_gate, 'pending');
  end if;

  return p_to;
end;
$$;

/* ---- the claim resumes work in progress -------------------------------- */

drop function if exists public.agentsync_claim_next_task(text, integer);
drop function if exists agentsync.claim_next_task(text, integer, uuid);

create function agentsync.claim_next_task(
  p_worker_id text,
  p_lease_seconds integer default 1800,
  p_tenant_id uuid default null
)
returns table (
  task_id uuid, tenant_id uuid, project_id uuid, correlation_id uuid,
  title text, request_type agentsync.request_type,
  priority agentsync.task_priority, status agentsync.task_status,
  lock_expires_at timestamptz
)
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_status agentsync.task_status;
begin
  select t.id, t.status into v_id, v_status
    from agentsync.agent_tasks t
    join agentsync.projects p on p.id = t.project_id
   where t.status in ('queued','analysing','planning','implementing','testing',
                      'creating_pull_request','deploying_production')
     and (t.locked_by is null or t.lock_expires_at < now())
     and (t.next_attempt_at is null or t.next_attempt_at <= now())
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
     -- finish what is started before starting something new
     case when t.status = 'queued' then 1 else 0 end,
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
         lock_expires_at = now() + make_interval(secs => p_lease_seconds),
         next_attempt_at = null
   where id = v_id;

  if v_status = 'queued' then
    perform agentsync.transition_task(
      v_id, 'analysing', p_worker_id,
      'Worker ' || p_worker_id || ' picked the task up',
      jsonb_build_object('worker_id', p_worker_id, 'lease_seconds', p_lease_seconds)
    );
  end if;

  return query
    select t.id, t.tenant_id, t.project_id, t.correlation_id, t.title,
           t.request_type, t.priority, t.status, t.lock_expires_at
      from agentsync.agent_tasks t where t.id = v_id;
end;
$$;

create function public.agentsync_claim_next_task(
  p_worker_id text,
  p_lease_seconds integer default 1800
)
returns jsonb
language sql security definer set search_path = ''
as $$
  select coalesce(to_jsonb(c), 'null'::jsonb)
  from agentsync.claim_next_task(p_worker_id, p_lease_seconds) c;
$$;

-- A dead worker's task keeps its status; clearing the lock is enough for the
-- claim above to pick it up where it stopped.
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
       set locked_by = null, lock_expires_at = null
     where id = v_task.id;

    insert into agentsync.task_events (tenant_id, task_id, event_type, message, actor, correlation_id, metadata)
    values (v_task.tenant_id, v_task.id, 'worker.lease_expired',
            'Lease expired while ' || v_task.status || '; another worker will resume it',
            v_task.locked_by, v_task.correlation_id,
            jsonb_build_object('status', v_task.status));

    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

/* ---- worker writers (service role only) -------------------------------- */

-- Hands a task back without changing its status, optionally not before a
-- delay. Used while waiting on checks, and after each completed stage.
create or replace function public.agentsync_release_task(
  p_task_id uuid, p_worker_id text, p_delay_seconds integer default 0
)
returns boolean
language sql security definer set search_path = ''
as $$
  with released as (
    update agentsync.agent_tasks
       set locked_by = null, lock_expires_at = null,
           next_attempt_at = case when p_delay_seconds > 0
                                  then now() + make_interval(secs => p_delay_seconds)
                                  else null end
     where id = p_task_id and locked_by = p_worker_id
    returning 1
  )
  select exists (select 1 from released);
$$;

-- Everything a worker loads about a task in one read.
create or replace function public.agentsync_worker_task(p_task_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'task', to_jsonb(t),
    'project', to_jsonb(p),
    'repository', (select to_jsonb(r) from agentsync.project_repositories r
                    where r.project_id = p.id order by r.created_at limit 1),
    'runtime', (select to_jsonb(rc) from agentsync.project_runtime_configs rc
                 where rc.project_id = p.id order by rc.created_at limit 1),
    'github', (select to_jsonb(g) from agentsync.github_app_installations g
                where g.tenant_id = t.tenant_id order by g.created_at limit 1),
    'ai', (select to_jsonb(a) from agentsync.ai_provider_credentials a
            where (a.tenant_id = t.tenant_id or a.tenant_id is null)
              and a.provider = 'anthropic'
            order by a.tenant_id nulls last limit 1),
    'plan', (select to_jsonb(pl) from agentsync.task_plans pl
              where pl.task_id = t.id order by pl.version desc limit 1),
    'feedback', (select jsonb_agg(jsonb_build_object(
                    'gate', ap.gate, 'decision', ap.decision, 'comments', ap.comments,
                    'decided_at', ap.decided_at) order by ap.decided_at)
                   from agentsync.task_approvals ap
                  where ap.task_id = t.id and ap.decision = 'changes_requested'),
    'month_spend', (select coalesce(sum(u.cost), 0) from agentsync.task_ai_usage u
                     join agentsync.agent_tasks t2 on t2.id = u.task_id
                    where t2.project_id = p.id
                      and u.created_at >= date_trunc('month', now()))
  )
  from agentsync.agent_tasks t
  join agentsync.projects p on p.id = t.project_id
  where t.id = p_task_id;
$$;

-- The agent definition a stage runs as: tenant/project overrides first, then
-- the platform default.
create or replace function public.agentsync_agent_for(p_task_id uuid, p_key text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select to_jsonb(a) || jsonb_build_object('model', c.primary_model)
    from agentsync.agent_tasks t
    join agentsync.agent_definitions a
      on a.key = p_key
     and (a.tenant_id is null or a.tenant_id = t.tenant_id)
     and (a.project_id is null or a.project_id = t.project_id)
    left join agentsync.agent_ai_configs c on c.agent_definition_id = a.id
   where t.id = p_task_id
   order by a.project_id nulls last, a.tenant_id nulls last
   limit 1;
$$;

-- Whitelisted field updates, so a stage cannot touch status, locks or tenancy.
create or replace function public.agentsync_update_task(p_task_id uuid, p_fields jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update agentsync.agent_tasks set
    branch_name = case when p_fields ? 'branch_name' then p_fields->>'branch_name' else branch_name end,
    commit_sha = case when p_fields ? 'commit_sha' then p_fields->>'commit_sha' else commit_sha end,
    pull_request_url = case when p_fields ? 'pull_request_url' then p_fields->>'pull_request_url' else pull_request_url end,
    pull_request_number = case when p_fields ? 'pull_request_number' then (p_fields->>'pull_request_number')::int else pull_request_number end,
    pull_request_body = case when p_fields ? 'pull_request_body' then p_fields->>'pull_request_body' else pull_request_body end,
    result_summary = case when p_fields ? 'result_summary' then p_fields->>'result_summary' else result_summary end,
    error_code = case when p_fields ? 'error_code' then p_fields->>'error_code' else error_code end,
    repair_attempts = case when p_fields ? 'repair_attempts' then (p_fields->>'repair_attempts')::int else repair_attempts end,
    stage_state = case when p_fields ? 'stage_state' then stage_state || (p_fields->'stage_state') else stage_state end
  where id = p_task_id;
end;
$$;

create or replace function public.agentsync_log_event(
  p_task_id uuid, p_event_type text, p_message text,
  p_actor text default 'worker', p_metadata jsonb default '{}'::jsonb
)
returns void
language sql security definer set search_path = ''
as $$
  insert into agentsync.task_events (tenant_id, task_id, event_type, message, actor, correlation_id, metadata)
  select t.tenant_id, t.id, p_event_type, p_message, p_actor, t.correlation_id, p_metadata
    from agentsync.agent_tasks t where t.id = p_task_id;
$$;

create or replace function public.agentsync_record_plan(p_task_id uuid, p_plan jsonb)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_version integer;
begin
  select coalesce(max(version), 0) + 1 into v_version
    from agentsync.task_plans where task_id = p_task_id;

  insert into agentsync.task_plans (
    tenant_id, task_id, version, summary, steps, assumptions, affected_files,
    testing_plan, rollback_plan, open_questions, complexity
  )
  select t.tenant_id, t.id, v_version,
         p_plan->>'summary',
         coalesce(p_plan->'steps', '[]'::jsonb),
         array(select jsonb_array_elements_text(coalesce(p_plan->'assumptions', '[]'))),
         array(select jsonb_array_elements_text(coalesce(p_plan->'affected_files', '[]'))),
         p_plan->>'testing_plan',
         p_plan->>'rollback_plan',
         array(select jsonb_array_elements_text(coalesce(p_plan->'open_questions', '[]'))),
         p_plan->>'complexity'
    from agentsync.agent_tasks t where t.id = p_task_id;
  return v_version;
end;
$$;

create or replace function public.agentsync_record_file_change(
  p_task_id uuid, p_path text, p_action text,
  p_additions integer, p_deletions integer,
  p_checksum_before text default null, p_checksum_after text default null
)
returns void
language sql security definer set search_path = ''
as $$
  insert into agentsync.task_file_changes (
    tenant_id, task_id, file_path, action, additions, deletions, checksum_before, checksum_after
  )
  select t.tenant_id, t.id, p_path, p_action::agentsync.file_action,
         p_additions, p_deletions, p_checksum_before, p_checksum_after
    from agentsync.agent_tasks t where t.id = p_task_id;
$$;

create or replace function public.agentsync_record_command_run(
  p_task_id uuid, p_command_type text, p_command text, p_result text,
  p_exit_code integer default null, p_duration_seconds numeric default null,
  p_attempt integer default 1, p_output text default null, p_error_summary text default null
)
returns void
language sql security definer set search_path = ''
as $$
  insert into agentsync.task_command_runs (
    tenant_id, task_id, command_type, command, exit_code, duration_seconds,
    attempt, result, sanitised_output, error_summary
  )
  select t.tenant_id, t.id, p_command_type::agentsync.command_type, p_command, p_exit_code,
         p_duration_seconds, p_attempt, p_result::agentsync.command_result,
         p_output, p_error_summary
    from agentsync.agent_tasks t where t.id = p_task_id;
$$;

create or replace function public.agentsync_record_review(p_task_id uuid, p_review jsonb)
returns void
language sql security definer set search_path = ''
as $$
  insert into agentsync.task_reviews (
    tenant_id, task_id, verdict, summary, criteria_matrix, findings, requires_human
  )
  select t.tenant_id, t.id, (p_review->>'verdict')::agentsync.review_verdict,
         p_review->>'summary', coalesce(p_review->'criteria', '[]'::jsonb),
         coalesce(p_review->'findings', '[]'::jsonb), true
    from agentsync.agent_tasks t where t.id = p_task_id;
$$;

create or replace function public.agentsync_record_ai_usage(
  p_task_id uuid, p_agent_key text, p_model text,
  p_input_tokens bigint, p_output_tokens bigint, p_cost numeric, p_duration_seconds numeric
)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  insert into agentsync.task_ai_usage (
    tenant_id, task_id, agent_definition_id, provider, model,
    input_tokens, output_tokens, cost, duration_seconds
  )
  select t.tenant_id, t.id,
         (select a.id from agentsync.agent_definitions a
           where a.key = p_agent_key and (a.tenant_id is null or a.tenant_id = t.tenant_id)
           order by a.tenant_id nulls last limit 1),
         'anthropic', p_model, p_input_tokens, p_output_tokens, p_cost, p_duration_seconds
    from agentsync.agent_tasks t where t.id = p_task_id;

  update agentsync.agent_tasks
     set input_tokens = coalesce(input_tokens, 0) + p_input_tokens,
         output_tokens = coalesce(output_tokens, 0) + p_output_tokens,
         estimated_cost = coalesce(estimated_cost, 0) + p_cost
   where id = p_task_id;
end;
$$;

/* ---- human decisions ---------------------------------------------------- */

-- The one way a gate opens. Checks the user may approve for the task's tenant,
-- that the task is actually at this gate, records the decision against the
-- user, and makes the human-only transition.
create or replace function agentsync.decide_approval(
  p_user_id uuid,
  p_task_id uuid,
  p_gate text,
  p_decision text,
  p_comment text default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_task agentsync.agent_tasks;
  v_user agentsync.users;
  v_role agentsync.user_role;
  v_expected agentsync.task_status;
  v_to agentsync.task_status;
begin
  select * into v_user from agentsync.users where id = p_user_id and state = 'ACTIVE';
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  end if;

  select * into v_task from agentsync.agent_tasks where id = p_task_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NO_SUCH_TASK');
  end if;

  select tu.role into v_role from agentsync.tenant_users tu
   where tu.tenant_id = v_task.tenant_id and tu.user_id = p_user_id and tu.state = 'ACTIVE';

  if not (v_user.role = 'SUPER_ADMIN'
          or coalesce(v_role, 'VIEWER') in ('SUPER_ADMIN', 'TENANT_ADMIN', 'APPROVER')) then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  end if;

  v_expected := case p_gate
    when 'plan' then 'awaiting_plan_approval'
    when 'merge' then 'awaiting_merge_approval'
    when 'production' then 'awaiting_production_approval'
    else null end;
  if v_expected is null then
    return jsonb_build_object('ok', false, 'error', 'UNKNOWN_GATE');
  end if;
  if v_task.status <> v_expected then
    return jsonb_build_object('ok', false, 'error', 'NOT_AT_GATE', 'detail', v_task.status);
  end if;

  if p_decision not in ('approved', 'rejected', 'changes_requested') then
    return jsonb_build_object('ok', false, 'error', 'UNKNOWN_DECISION');
  end if;
  if p_decision = 'changes_requested' and coalesce(trim(p_comment), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'COMMENT_REQUIRED');
  end if;

  v_to := case p_gate || ':' || p_decision
    when 'plan:approved' then 'implementing'
    when 'plan:changes_requested' then 'planning'
    when 'plan:rejected' then 'cancelled'
    when 'merge:approved' then 'deploying_production'
    when 'merge:changes_requested' then 'implementing'
    when 'merge:rejected' then 'cancelled'
    when 'production:approved' then 'deploying_production'
    when 'production:rejected' then 'cancelled'
    else null end;
  if v_to is null then
    return jsonb_build_object('ok', false, 'error', 'UNSUPPORTED_DECISION');
  end if;

  update agentsync.task_approvals
     set decision = p_decision::agentsync.approval_decision,
         decided_by = v_user.id,
         decided_by_email = v_user.email,
         decided_by_role = coalesce(v_role, v_user.role),
         comments = nullif(trim(p_comment), ''),
         decided_at = now()
   where task_id = p_task_id and gate = p_gate::agentsync.approval_gate and decision = 'pending';
  if not found then
    insert into agentsync.task_approvals (
      tenant_id, task_id, gate, decision, decided_by, decided_by_email,
      decided_by_role, comments, decided_at
    ) values (
      v_task.tenant_id, p_task_id, p_gate::agentsync.approval_gate,
      p_decision::agentsync.approval_decision, v_user.id, v_user.email,
      coalesce(v_role, v_user.role), nullif(trim(p_comment), ''), now()
    );
  end if;

  perform set_config('agentsync.human_decision', 'on', true);
  perform agentsync.transition_task(
    p_task_id, v_to, 'user:' || v_user.email,
    initcap(p_gate) || ' ' || replace(p_decision, '_', ' ') || ' by ' || v_user.email
      || coalesce(': ' || nullif(trim(p_comment), ''), '')
  );
  perform set_config('agentsync.human_decision', 'off', true);

  -- The next tick should pick it up straight away.
  update agentsync.agent_tasks
     set locked_by = null, lock_expires_at = null, next_attempt_at = null,
         repair_attempts = case when p_decision = 'changes_requested' then 0 else repair_attempts end
   where id = p_task_id;

  return jsonb_build_object('ok', true, 'status', v_to,
                            'pull_request_number', v_task.pull_request_number);
end;
$$;

create or replace function public.agentsync_decide_approval(
  p_user_id uuid, p_task_id uuid, p_gate text, p_decision text, p_comment text default null
)
returns jsonb
language sql security definer set search_path = ''
as $$ select agentsync.decide_approval(p_user_id, p_task_id, p_gate, p_decision, p_comment); $$;

/* ---- portal setup: projects and source keys ---------------------------- */

create or replace function public.agentsync_create_project(
  p_user_id uuid,
  p_tenant_slug text,
  p_name text,
  p_github_owner text,
  p_repository text,
  p_default_branch text default 'main',
  p_plan_approval_required boolean default true,
  p_protected_paths text[] default array['.github/workflows/**', '.env*', '**/*.pem']
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_slug text;
  v_project uuid;
begin
  v_tenant := agentsync.configurable_tenant(p_user_id, p_tenant_slug);
  if v_tenant is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  end if;
  if coalesce(trim(p_name), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'NAME_REQUIRED');
  end if;
  if coalesce(trim(p_github_owner), '') = '' or coalesce(trim(p_repository), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'REPOSITORY_REQUIRED');
  end if;

  v_slug := trim(both '-' from regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g'));
  if exists (select 1 from agentsync.projects where tenant_id = v_tenant and slug = v_slug) then
    return jsonb_build_object('ok', false, 'error', 'PROJECT_EXISTS');
  end if;

  insert into agentsync.projects (tenant_id, name, slug, plan_approval_required, merge_approval_required)
  values (v_tenant, trim(p_name), v_slug, p_plan_approval_required, true)
  returning id into v_project;

  insert into agentsync.project_repositories (
    tenant_id, project_id, github_owner, repository, default_branch, protected_paths
  ) values (
    v_tenant, v_project, trim(p_github_owner), trim(p_repository),
    coalesce(nullif(trim(p_default_branch), ''), 'main'), p_protected_paths
  );

  return jsonb_build_object('ok', true, 'project_id', v_project, 'slug', v_slug);
end;
$$;

create or replace function public.agentsync_portal_issue_source_key(
  p_user_id uuid, p_tenant_slug text, p_name text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_row record;
begin
  v_tenant := agentsync.configurable_tenant(p_user_id, p_tenant_slug);
  if v_tenant is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  end if;
  if coalesce(trim(p_name), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'NAME_REQUIRED');
  end if;

  select * into v_row from agentsync.issue_source_system_key(v_tenant, trim(p_name));
  return jsonb_build_object('ok', true, 'source_system_id', v_row.source_system_id,
                            'api_key', v_row.api_key);
end;
$$;

/* ---- auth wrappers that existed live but not in a migration ------------ */

create or replace function public.agentsync_verify_password(p_email text, p_password text)
returns uuid language sql security definer set search_path = ''
as $$ select agentsync.verify_password(p_email, p_password); $$;

create or replace function public.agentsync_create_user(
  p_email text, p_display_name text, p_password text,
  p_role agentsync.user_role default 'VIEWER'
)
returns uuid language sql security definer set search_path = ''
as $$ select agentsync.create_user(p_email, p_display_name, p_password, p_role); $$;

create or replace function public.agentsync_set_password(p_user_id uuid, p_password text)
returns void language sql security definer set search_path = ''
as $$ select agentsync.set_password(p_user_id, p_password); $$;

create or replace function public.agentsync_session_user(p_user_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', u.id,
    'email', u.email,
    'display_name', u.display_name,
    'role', u.role,
    'state', u.state,
    'last_login_at', u.last_login_at,
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'tenant_id', t.id, 'slug', t.slug, 'name', t.name, 'role', tu.role
      ) order by t.name)
      from agentsync.tenant_users tu
      join agentsync.tenants t on t.id = tu.tenant_id
      where tu.user_id = u.id and tu.state <> 'SUSPENDED'
    ), '[]'::jsonb)
  )
  from agentsync.users u
  where u.id = p_user_id and u.state = 'ACTIVE';
$$;

/* ---- grants ------------------------------------------------------------ */

do $$
declare
  f text;
begin
  foreach f in array array[
    'agentsync.claim_next_task(text, integer, uuid)',
    'agentsync.decide_approval(uuid, uuid, text, text, text)',
    'public.agentsync_claim_next_task(text, integer)',
    'public.agentsync_release_task(uuid, text, integer)',
    'public.agentsync_worker_task(uuid)',
    'public.agentsync_agent_for(uuid, text)',
    'public.agentsync_update_task(uuid, jsonb)',
    'public.agentsync_log_event(uuid, text, text, text, jsonb)',
    'public.agentsync_record_plan(uuid, jsonb)',
    'public.agentsync_record_file_change(uuid, text, text, integer, integer, text, text)',
    'public.agentsync_record_command_run(uuid, text, text, text, integer, numeric, integer, text, text)',
    'public.agentsync_record_review(uuid, jsonb)',
    'public.agentsync_record_ai_usage(uuid, text, text, bigint, bigint, numeric, numeric)',
    'public.agentsync_decide_approval(uuid, uuid, text, text, text)',
    'public.agentsync_create_project(uuid, text, text, text, text, text, boolean, text[])',
    'public.agentsync_portal_issue_source_key(uuid, text, text)',
    'public.agentsync_verify_password(text, text)',
    'public.agentsync_create_user(text, text, text, agentsync.user_role)',
    'public.agentsync_set_password(uuid, text)',
    'public.agentsync_session_user(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
