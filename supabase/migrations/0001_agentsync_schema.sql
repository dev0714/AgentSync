-- AgentSync control plane schema.
--
-- Everything the platform knows lives under the `agentsync` schema: tenant and
-- project configuration, agent definitions, the task record and its artefacts,
-- and the append-only event log.
--
-- Isolation model:
--   * every tenant-scoped table carries tenant_id and has RLS enabled
--   * membership is resolved through agentsync.tenant_users against auth.uid()
--   * task_events has an INSERT policy and no UPDATE or DELETE policy, so the
--     log is append-only for every role that goes through RLS
--   * workers use the service role, which bypasses RLS and must never be used
--     from a browser

create schema if not exists agentsync;

comment on schema agentsync is
  'AgentSync control plane: tenants, projects, agents, tasks and audit events.';

-- ---------------------------------------------------------------------------
-- enums
-- ---------------------------------------------------------------------------

create type agentsync.tenant_status as enum ('active', 'trial', 'suspended', 'closed');

create type agentsync.user_role as enum (
  'SUPER_ADMIN',
  'TENANT_ADMIN',
  'PROJECT_MANAGER',
  'DEVELOPER',
  'APPROVER',
  'VIEWER'
);

create type agentsync.member_state as enum ('ACTIVE', 'SUSPENDED', 'SERVICE');

create type agentsync.request_type as enum (
  'code_change',
  'refactor',
  'dependency_update',
  'migration',
  'investigation',
  'estimate',
  'custom'
);

create type agentsync.task_priority as enum ('low', 'normal', 'high', 'urgent');

create type agentsync.task_status as enum (
  'received',
  'validating',
  'queued',
  'analysing',
  'planning',
  'awaiting_plan_approval',
  'implementing',
  'testing',
  'awaiting_merge_approval',
  'creating_pull_request',
  'deploying_preview',
  'awaiting_production_approval',
  'deploying_production',
  'needs_information',
  'completed',
  'failed',
  'cancelled',
  'rolled_back'
);

create type agentsync.approval_gate as enum ('plan', 'merge', 'production', 'information');

create type agentsync.approval_decision as enum ('pending', 'approved', 'rejected', 'changes_requested');

create type agentsync.file_action as enum ('CREATED', 'MODIFIED', 'DELETED', 'RENAMED');

create type agentsync.command_type as enum ('install', 'lint', 'typecheck', 'test', 'build', 'custom');

create type agentsync.command_result as enum ('PASSED', 'FAILED', 'REPAIRED', 'SKIPPED');

create type agentsync.review_verdict as enum ('submit', 'changes', 'reject');

create type agentsync.finding_severity as enum ('low', 'medium', 'high');

create type agentsync.tool_grant as enum ('ALLOW', 'LIMITED', 'DENY');

create type agentsync.deployment_env as enum ('preview', 'production', 'rollback');

create type agentsync.deployment_status as enum (
  'QUEUED',
  'BUILDING',
  'READY',
  'ERROR',
  'CANCELLED',
  'AWAITING_APPROVAL'
);

create type agentsync.source_state as enum ('ACTIVE', 'DISABLED', 'TEST');

create type agentsync.ai_provider as enum ('anthropic', 'openai', 'none');

-- ---------------------------------------------------------------------------
-- tenants and membership
-- ---------------------------------------------------------------------------

create table agentsync.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  plan text not null default 'trial',
  status agentsync.tenant_status not null default 'trial',
  primary_contact text,
  billing_email text,
  data_region text not null default 'eu-west-1',
  notes text,
  -- limits, billing and policy defaults; mirrors tenants.settings in the portal
  settings jsonb not null default '{}'::jsonb,
  trial_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table agentsync.tenant_users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references agentsync.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role agentsync.user_role not null default 'VIEWER',
  state agentsync.member_state not null default 'ACTIVE',
  display_name text,
  email text,
  last_active_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

create index tenant_users_user_idx on agentsync.tenant_users (user_id);
create index tenant_users_tenant_idx on agentsync.tenant_users (tenant_id);

-- Membership helpers. SECURITY DEFINER so policies can read tenant_users
-- without recursing through that table's own RLS.
create or replace function agentsync.is_member(target_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = agentsync, public
as $$
  select exists (
    select 1
    from agentsync.tenant_users tu
    where tu.tenant_id = target_tenant
      and tu.user_id = auth.uid()
      and tu.state <> 'SUSPENDED'
  );
$$;

create or replace function agentsync.has_role(
  target_tenant uuid,
  allowed agentsync.user_role[]
)
returns boolean
language sql
stable
security definer
set search_path = agentsync, public
as $$
  select exists (
    select 1
    from agentsync.tenant_users tu
    where tu.tenant_id = target_tenant
      and tu.user_id = auth.uid()
      and tu.state = 'ACTIVE'
      and tu.role = any (allowed)
  );
$$;

-- Writes to configuration are limited to these roles everywhere below.
create or replace function agentsync.can_configure(target_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = agentsync, public
as $$
  select agentsync.has_role(
    target_tenant,
    array['SUPER_ADMIN', 'TENANT_ADMIN', 'PROJECT_MANAGER']::agentsync.user_role[]
  );
$$;

-- ---------------------------------------------------------------------------
-- projects and their configuration
-- ---------------------------------------------------------------------------

create table agentsync.projects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references agentsync.tenants (id) on delete cascade,
  name text not null,
  slug text not null,
  enabled boolean not null default true,
  -- approval policy
  plan_approval_required boolean not null default true,
  merge_approval_required boolean not null default true,
  production_requires_approval boolean not null default true,
  agent_may_merge_own_pr boolean not null default false,
  direct_push_to_default boolean not null default false,
  callback_url text,
  callback_signing_secret_ref text,
  rollback_policy text not null default 'revert commit · new PR · human merge',
  monthly_ai_budget numeric(10, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, slug)
);

create index projects_tenant_idx on agentsync.projects (tenant_id);

create table agentsync.project_repositories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references agentsync.tenants (id) on delete cascade,
  project_id uuid not null unique references agentsync.projects (id) on delete cascade,
  github_owner text not null,
  repository text not null,
  default_branch text not null default 'main',
  branch_prefix text not null default 'ai/',
  installation_id bigint,
  pull_requests_required boolean not null default true,
  protected_paths text[] not null default '{}',
  allowed_paths text[] not null default '{}',
  maximum_files_changed integer not null default 20,
  maximum_lines_changed integer not null default 400,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table agentsync.project_runtime_configs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references agentsync.tenants (id) on delete cascade,
  project_id uuid not null unique references agentsync.projects (id) on delete cascade,
  framework text,
  runtime text,
  package_manager text not null default 'npm',
  install_command text,
  lint_command text,
  typecheck_command text,
  test_command text,
  build_command text,
  maximum_execution_minutes integer not null default 25,
  maximum_repair_attempts integer not null default 2,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table agentsync.project_ai_configs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references agentsync.tenants (id) on delete cascade,
  project_id uuid not null unique references agentsync.projects (id) on delete cascade,
  primary_provider agentsync.ai_provider not null default 'anthropic',
  primary_model text not null,
  fallback_provider agentsync.ai_provider not null default 'none',
  fallback_model text,
  fallback_permitted boolean not null default false,
  system_prompt text,
  coding_instructions text,
  maximum_input_tokens integer not null default 400000,
  maximum_output_tokens integer not null default 64000,
  maximum_task_cost numeric(10, 2) not null default 2.00,
  temperature numeric(3, 2) not null default 0.20,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Systems permitted to submit tasks. Keys are stored hashed; signing secrets
-- live in the secret manager and are referenced by identifier only.
create table agentsync.source_systems (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references agentsync.tenants (id) on delete cascade,
  name text not null,
  api_key_prefix text not null,
  api_key_hash text not null,
  signing_secret_ref text,
  ip_allowlist text[] not null default '{}',
  rate_limit_per_minute integer not null default 60,
  state agentsync.source_state not null default 'ACTIVE',
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create index source_systems_prefix_idx on agentsync.source_systems (api_key_prefix);

-- ---------------------------------------------------------------------------
-- agent definitions
-- ---------------------------------------------------------------------------

create table agentsync.agent_definitions (
  id uuid primary key default gen_random_uuid(),
  -- null tenant_id = platform default, inherited by every tenant
  tenant_id uuid references agentsync.tenants (id) on delete cascade,
  project_id uuid references agentsync.projects (id) on delete cascade,
  key text not null,
  display_name text not null,
  stage_order integer not null,
  purpose text,
  request_types agentsync.request_type[] not null default '{}',
  enabled boolean not null default true,
  optional_stage boolean not null default false,
  terminal_stage boolean not null default false,
  blocking boolean not null default false,
  veto_power boolean not null default false,
  may_self_approve boolean not null default false,
  requires_approved_plan boolean not null default false,
  system_prompt text,
  inputs jsonb not null default '{}'::jsonb,
  outputs jsonb not null default '{}'::jsonb,
  checks jsonb not null default '{}'::jsonb,
  limits jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, key)
);

create index agent_definitions_tenant_idx on agentsync.agent_definitions (tenant_id);

create table agentsync.agent_ai_configs (
  id uuid primary key default gen_random_uuid(),
  agent_definition_id uuid not null unique
    references agentsync.agent_definitions (id) on delete cascade,
  primary_model text not null,
  fallback_model text,
  fallback_permitted boolean not null default true,
  temperature numeric(3, 2) not null default 0.20,
  thinking_budget text,
  context_strategy text,
  response_format text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table agentsync.agent_tools (
  id uuid primary key default gen_random_uuid(),
  agent_definition_id uuid not null
    references agentsync.agent_definitions (id) on delete cascade,
  tool_name text not null,
  scope text,
  grant_level agentsync.tool_grant not null default 'DENY',
  unique (agent_definition_id, tool_name)
);

create table agentsync.agent_templates (
  id uuid primary key default gen_random_uuid(),
  agent_definition_id uuid not null
    references agentsync.agent_definitions (id) on delete cascade,
  template_key text not null,
  template_value text not null,
  unique (agent_definition_id, template_key)
);

-- ---------------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------------

create table agentsync.agent_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references agentsync.tenants (id) on delete cascade,
  project_id uuid not null references agentsync.projects (id) on delete cascade,
  source_system_id uuid references agentsync.source_systems (id) on delete set null,
  external_reference text,
  correlation_id uuid not null default gen_random_uuid(),
  idempotency_key text not null,
  request_type agentsync.request_type not null default 'code_change',
  priority agentsync.task_priority not null default 'normal',
  status agentsync.task_status not null default 'received',
  title text not null,
  description text,
  acceptance_criteria text[] not null default '{}',
  requested_by jsonb,
  callback_url text,
  branch_name text,
  commit_sha text,
  pull_request_url text,
  pull_request_number integer,
  pull_request_body text,
  result_summary text,
  error_code text,
  progress_percent smallint not null default 0
    check (progress_percent between 0 and 100),
  -- worker coordination: one lock per task, expiring so a dead worker frees it
  locked_by text,
  lock_expires_at timestamptz,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  estimated_cost numeric(10, 4) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  -- a retry must never produce a second branch, PR, deployment or callback
  unique (tenant_id, idempotency_key)
);

create index agent_tasks_tenant_status_idx on agentsync.agent_tasks (tenant_id, status);
create index agent_tasks_project_idx on agentsync.agent_tasks (project_id);
create index agent_tasks_updated_idx on agentsync.agent_tasks (updated_at desc);
create index agent_tasks_queue_idx on agentsync.agent_tasks (status, priority, created_at)
  where status in ('queued', 'received');

create table agentsync.task_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references agentsync.tenants (id) on delete cascade,
  task_id uuid not null references agentsync.agent_tasks (id) on delete cascade,
  version integer not null default 1,
  summary text not null,
  steps jsonb not null default '[]'::jsonb,
  assumptions text[] not null default '{}',
  affected_files text[] not null default '{}',
  testing_plan text,
  rollback_plan text,
  open_questions text[] not null default '{}',
  complexity text,
  created_at timestamptz not null default now(),
  unique (task_id, version)
);

create table agentsync.task_file_changes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references agentsync.tenants (id) on delete cascade,
  task_id uuid not null references agentsync.agent_tasks (id) on delete cascade,
  file_path text not null,
  action agentsync.file_action not null,
  additions integer not null default 0,
  deletions integer not null default 0,
  checksum_before text,
  checksum_after text,
  created_at timestamptz not null default now()
);

create index task_file_changes_task_idx on agentsync.task_file_changes (task_id);

create table agentsync.task_command_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references agentsync.tenants (id) on delete cascade,
  task_id uuid not null references agentsync.agent_tasks (id) on delete cascade,
  command_type agentsync.command_type not null,
  command text not null,
  exit_code integer,
  duration_seconds numeric(8, 2),
  attempt integer not null default 1,
  result agentsync.command_result not null default 'SKIPPED',
  -- output is redacted before it is written here
  sanitised_output text,
  error_summary text,
  created_at timestamptz not null default now()
);

create index task_command_runs_task_idx on agentsync.task_command_runs (task_id);

create table agentsync.task_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references agentsync.tenants (id) on delete cascade,
  task_id uuid not null references agentsync.agent_tasks (id) on delete cascade,
  verdict agentsync.review_verdict not null,
  summary text,
  criteria_matrix jsonb not null default '[]'::jsonb,
  findings jsonb not null default '[]'::jsonb,
  requires_human boolean not null default false,
  created_at timestamptz not null default now()
);

create table agentsync.task_security_findings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references agentsync.tenants (id) on delete cascade,
  task_id uuid not null references agentsync.agent_tasks (id) on delete cascade,
  severity agentsync.finding_severity not null,
  category text not null,
  file_path text,
  line_number integer,
  -- never store the discovered secret itself, only where it was found
  description text not null,
  blocking boolean not null default false,
  created_at timestamptz not null default now()
);

create index task_security_findings_task_idx on agentsync.task_security_findings (task_id);

create table agentsync.task_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references agentsync.tenants (id) on delete cascade,
  task_id uuid not null references agentsync.agent_tasks (id) on delete cascade,
  findings jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  root_cause text,
  recommended_action text,
  effort_estimate text,
  created_at timestamptz not null default now()
);

create table agentsync.task_approvals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references agentsync.tenants (id) on delete cascade,
  task_id uuid not null references agentsync.agent_tasks (id) on delete cascade,
  gate agentsync.approval_gate not null,
  decision agentsync.approval_decision not null default 'pending',
  decided_by uuid references auth.users (id) on delete set null,
  decided_by_email text,
  decided_by_role agentsync.user_role,
  comments text,
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (task_id, gate)
);

create index task_approvals_pending_idx on agentsync.task_approvals (tenant_id, decision)
  where decision = 'pending';

create table agentsync.task_ai_usage (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references agentsync.tenants (id) on delete cascade,
  task_id uuid not null references agentsync.agent_tasks (id) on delete cascade,
  agent_definition_id uuid references agentsync.agent_definitions (id) on delete set null,
  provider agentsync.ai_provider not null,
  model text not null,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cost numeric(10, 4) not null default 0,
  failover boolean not null default false,
  duration_seconds numeric(8, 2),
  created_at timestamptz not null default now()
);

create index task_ai_usage_tenant_idx on agentsync.task_ai_usage (tenant_id, created_at desc);

-- Append-only. Every state transition, approval, guardrail refusal and
-- provider call is written here and never updated or deleted.
create table agentsync.task_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references agentsync.tenants (id) on delete cascade,
  task_id uuid references agentsync.agent_tasks (id) on delete cascade,
  event_type text not null,
  message text,
  actor text,
  correlation_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index task_events_tenant_time_idx on agentsync.task_events (tenant_id, created_at desc);
create index task_events_task_idx on agentsync.task_events (task_id, created_at);

-- ---------------------------------------------------------------------------
-- deployments and connections
-- ---------------------------------------------------------------------------

create table agentsync.deployments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references agentsync.tenants (id) on delete cascade,
  project_id uuid not null references agentsync.projects (id) on delete cascade,
  task_id uuid references agentsync.agent_tasks (id) on delete set null,
  provider text not null default 'vercel',
  external_id text,
  environment agentsync.deployment_env not null,
  url text,
  branch text,
  commit_sha text,
  status agentsync.deployment_status not null default 'QUEUED',
  build_duration_seconds numeric(8, 2),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (provider, external_id)
);

create index deployments_tenant_idx on agentsync.deployments (tenant_id, started_at desc);

create table agentsync.github_app_installations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references agentsync.tenants (id) on delete cascade,
  app_slug text not null,
  installation_id bigint not null,
  private_key_reference text not null,
  webhook_secret_reference text not null,
  repository_allowlist text[] not null default '{}',
  token_ttl_minutes integer not null default 55,
  branch_protection_writes boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenant_id, installation_id)
);

create table agentsync.deployment_providers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references agentsync.tenants (id) on delete cascade,
  provider text not null default 'vercel',
  team_id text,
  api_token_reference text,
  token_scope text not null default 'read deployments only',
  preview_on text,
  production_trigger text,
  promote_via_api boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenant_id, provider)
);

create table agentsync.ai_provider_credentials (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references agentsync.tenants (id) on delete cascade,
  provider agentsync.ai_provider not null,
  model text,
  key_reference text not null,
  failover_triggers text,
  failover_requires_optin boolean not null default true,
  monthly_cap numeric(10, 2),
  hard_stop_at_cap boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, provider)
);

-- References only. Values never leave the secret manager.
create table agentsync.secret_references (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references agentsync.tenants (id) on delete cascade,
  reference text not null unique,
  used_by text,
  rotated_at timestamptz,
  rotation_days integer not null default 90,
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);

create table agentsync.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references agentsync.tenants (id) on delete cascade,
  direction text not null check (direction in ('IN', 'OUT')),
  path text not null,
  note text,
  signing_secret_ref text,
  replay_window_seconds integer not null default 300,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function agentsync.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'tenants',
    'projects',
    'project_repositories',
    'project_runtime_configs',
    'project_ai_configs',
    'agent_definitions',
    'agent_ai_configs',
    'agent_tasks'
  ]
  loop
    execute format(
      'create trigger %I before update on agentsync.%I
         for each row execute function agentsync.touch_updated_at()',
      t || '_touch_updated_at', t
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- row level security
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'tenants', 'tenant_users', 'projects', 'project_repositories',
    'project_runtime_configs', 'project_ai_configs', 'source_systems',
    'agent_definitions', 'agent_ai_configs', 'agent_tools', 'agent_templates',
    'agent_tasks', 'task_plans', 'task_file_changes', 'task_command_runs',
    'task_reviews', 'task_security_findings', 'task_reports', 'task_approvals',
    'task_ai_usage', 'task_events', 'deployments', 'github_app_installations',
    'deployment_providers', 'ai_provider_credentials', 'secret_references',
    'webhook_endpoints'
  ]
  loop
    execute format('alter table agentsync.%I enable row level security', t);
    execute format('alter table agentsync.%I force row level security', t);
  end loop;
end;
$$;

-- tenants: members read their own tenant, admins update it
create policy tenants_select on agentsync.tenants
  for select to authenticated
  using (agentsync.is_member(id));

create policy tenants_update on agentsync.tenants
  for update to authenticated
  using (agentsync.has_role(id, array['SUPER_ADMIN', 'TENANT_ADMIN']::agentsync.user_role[]))
  with check (agentsync.has_role(id, array['SUPER_ADMIN', 'TENANT_ADMIN']::agentsync.user_role[]));

-- tenant_users: members see the roster, admins manage it
create policy tenant_users_select on agentsync.tenant_users
  for select to authenticated
  using (agentsync.is_member(tenant_id));

create policy tenant_users_write on agentsync.tenant_users
  for all to authenticated
  using (agentsync.has_role(tenant_id, array['SUPER_ADMIN', 'TENANT_ADMIN']::agentsync.user_role[]))
  with check (agentsync.has_role(tenant_id, array['SUPER_ADMIN', 'TENANT_ADMIN']::agentsync.user_role[]));

-- Configuration tables: every member reads, configuring roles write.
do $$
declare
  t text;
begin
  foreach t in array array[
    'projects', 'project_repositories', 'project_runtime_configs',
    'project_ai_configs', 'source_systems',
    'github_app_installations', 'deployment_providers',
    'ai_provider_credentials', 'secret_references', 'webhook_endpoints'
  ]
  loop
    execute format(
      'create policy %I on agentsync.%I for select to authenticated
         using (tenant_id is null or agentsync.is_member(tenant_id))',
      t || '_select', t
    );
    execute format(
      'create policy %I on agentsync.%I for all to authenticated
         using (tenant_id is not null and agentsync.can_configure(tenant_id))
         with check (tenant_id is not null and agentsync.can_configure(tenant_id))',
      t || '_write', t
    );
  end loop;
end;
$$;

-- agent_definitions: platform defaults (tenant_id is null) are readable by all
create policy agent_definitions_select on agentsync.agent_definitions
  for select to authenticated
  using (tenant_id is null or agentsync.is_member(tenant_id));

create policy agent_definitions_write on agentsync.agent_definitions
  for all to authenticated
  using (tenant_id is not null and agentsync.can_configure(tenant_id))
  with check (tenant_id is not null and agentsync.can_configure(tenant_id));

create policy agent_ai_configs_select on agentsync.agent_ai_configs
  for select to authenticated
  using (
    exists (
      select 1
      from agentsync.agent_definitions d
      where d.id = agent_definition_id
        and (d.tenant_id is null or agentsync.is_member(d.tenant_id))
    )
  );

create policy agent_ai_configs_write on agentsync.agent_ai_configs
  for all to authenticated
  using (
    exists (
      select 1
      from agentsync.agent_definitions d
      where d.id = agent_definition_id
        and d.tenant_id is not null
        and agentsync.can_configure(d.tenant_id)
    )
  )
  with check (
    exists (
      select 1
      from agentsync.agent_definitions d
      where d.id = agent_definition_id
        and d.tenant_id is not null
        and agentsync.can_configure(d.tenant_id)
    )
  );

-- agent_tools and agent_templates inherit their scope from the parent definition.
do $$
declare
  t text;
begin
  foreach t in array array['agent_tools', 'agent_templates']
  loop
    execute format(
      'create policy %I on agentsync.%I for select to authenticated
         using (exists (
           select 1 from agentsync.agent_definitions d
           where d.id = agent_definition_id
             and (d.tenant_id is null or agentsync.is_member(d.tenant_id))
         ))',
      t || '_select', t
    );
    execute format(
      'create policy %I on agentsync.%I for all to authenticated
         using (exists (
           select 1 from agentsync.agent_definitions d
           where d.id = agent_definition_id
             and d.tenant_id is not null
             and agentsync.can_configure(d.tenant_id)
         ))
         with check (exists (
           select 1 from agentsync.agent_definitions d
           where d.id = agent_definition_id
             and d.tenant_id is not null
             and agentsync.can_configure(d.tenant_id)
         ))',
      t || '_write', t
    );
  end loop;
end;
$$;

-- Task records: read-only to the portal. Workers write with the service role.
do $$
declare
  t text;
begin
  foreach t in array array[
    'agent_tasks', 'task_plans', 'task_file_changes', 'task_command_runs',
    'task_reviews', 'task_security_findings', 'task_reports', 'task_ai_usage',
    'deployments'
  ]
  loop
    execute format(
      'create policy %I on agentsync.%I for select to authenticated
         using (agentsync.is_member(tenant_id))',
      t || '_select', t
    );
  end loop;
end;
$$;

-- Approvals are the one task-side record a human writes.
create policy task_approvals_select on agentsync.task_approvals
  for select to authenticated
  using (agentsync.is_member(tenant_id));

create policy task_approvals_decide on agentsync.task_approvals
  for update to authenticated
  using (
    agentsync.has_role(
      tenant_id,
      array['SUPER_ADMIN', 'TENANT_ADMIN', 'APPROVER']::agentsync.user_role[]
    )
  )
  with check (
    agentsync.has_role(
      tenant_id,
      array['SUPER_ADMIN', 'TENANT_ADMIN', 'APPROVER']::agentsync.user_role[]
    )
  );

-- task_events: insert and select only. No update or delete policy exists, so
-- the log cannot be rewritten through RLS by any role.
create policy task_events_select on agentsync.task_events
  for select to authenticated
  using (agentsync.is_member(tenant_id));

create policy task_events_insert on agentsync.task_events
  for insert to authenticated
  with check (agentsync.is_member(tenant_id));

-- Belt and braces: block rewrites even for a table owner that forgets RLS.
create or replace function agentsync.reject_event_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'agentsync.task_events is append-only';
end;
$$;

create trigger task_events_no_update
  before update or delete on agentsync.task_events
  for each row execute function agentsync.reject_event_mutation();

-- ---------------------------------------------------------------------------
-- grants
-- ---------------------------------------------------------------------------

grant usage on schema agentsync to authenticated, service_role;

grant select, insert, update, delete on all tables in schema agentsync to service_role;
grant usage, select on all sequences in schema agentsync to service_role;

-- The portal reaches the database as `authenticated`; the policies above decide
-- what that actually permits. The anon role gets nothing.
grant select on all tables in schema agentsync to authenticated;
grant insert, update on
  agentsync.tenants,
  agentsync.tenant_users,
  agentsync.projects,
  agentsync.project_repositories,
  agentsync.project_runtime_configs,
  agentsync.project_ai_configs,
  agentsync.source_systems,
  agentsync.agent_definitions,
  agentsync.agent_ai_configs,
  agentsync.agent_tools,
  agentsync.agent_templates,
  agentsync.task_approvals,
  agentsync.github_app_installations,
  agentsync.deployment_providers,
  agentsync.ai_provider_credentials,
  agentsync.secret_references,
  agentsync.webhook_endpoints
to authenticated;

grant delete on
  agentsync.tenant_users,
  agentsync.source_systems,
  agentsync.agent_tools,
  agentsync.agent_templates,
  agentsync.webhook_endpoints
to authenticated;

-- task_events is insert-and-read only for anyone going through RLS: no UPDATE
-- or DELETE privilege, and no policy for either.
grant insert on agentsync.task_events to authenticated;

grant usage, select on all sequences in schema agentsync to authenticated;

alter default privileges in schema agentsync
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema agentsync
  grant usage, select on sequences to service_role;
