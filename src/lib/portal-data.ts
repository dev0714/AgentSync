import 'server-only';
import { serviceClient } from './supabase';

/**
 * Everything the control plane displays, read from the database.
 *
 * There are no fixtures behind the portal — a screen with nothing on it means
 * the tenant genuinely has nothing yet, which is the useful signal. Two round
 * trips at most: one overview per page load, one more when a task is opened.
 *
 * Both database functions take the caller's user id and check tenant membership
 * themselves, so a hand-edited request cannot read another tenant's rows even
 * though this module holds the service-role key.
 */

export type Nullable<T> = T | null;

export type TenantSummary = {
  slug: string;
  name: string;
  plan: string | null;
  status: string;
  role: string;
  project_count: number;
  task_count: number;
};

export type Tenant = {
  slug: string;
  name: string;
  plan: string | null;
  status: string;
  primary_contact: string | null;
  billing_email: string | null;
  data_region: string | null;
  notes: string | null;
  settings: Record<string, unknown>;
  trial_ends_at: string | null;
  created_at: string;
};

export type Member = {
  display_name: string | null;
  email: string | null;
  role: string;
  state: string;
  last_active_at: string | null;
};

export type ProjectRepository = {
  github_owner: string | null;
  repository: string | null;
  default_branch: string | null;
  branch_prefix: string | null;
  installation_id: number | null;
  pull_requests_required: boolean | null;
  protected_paths: string[] | null;
  allowed_paths: string[] | null;
  maximum_files_changed: number | null;
  maximum_lines_changed: number | null;
};

export type ProjectRuntime = {
  framework: string | null;
  runtime: string | null;
  package_manager: string | null;
  install_command: string | null;
  lint_command: string | null;
  typecheck_command: string | null;
  test_command: string | null;
  build_command: string | null;
  maximum_execution_minutes: number | null;
  maximum_repair_attempts: number | null;
};

export type ProjectAi = {
  primary_provider: string | null;
  primary_model: string | null;
  fallback_provider: string | null;
  fallback_model: string | null;
  fallback_permitted: boolean | null;
  maximum_input_tokens: number | null;
  maximum_output_tokens: number | null;
  maximum_task_cost: number | null;
  temperature: number | null;
  system_prompt: string | null;
  coding_instructions: string | null;
};

export type Project = {
  id: string;
  name: string;
  slug: string;
  enabled: boolean;
  plan_approval_required: boolean;
  merge_approval_required: boolean;
  production_requires_approval: boolean;
  agent_may_merge_own_pr: boolean;
  direct_push_to_default: boolean;
  callback_url: string | null;
  callback_signing_secret_ref: string | null;
  rollback_policy: string | null;
  monthly_ai_budget: number | null;
  repository: Nullable<ProjectRepository>;
  runtime: Nullable<ProjectRuntime>;
  ai: Nullable<ProjectAi>;
  spend: number;
};

export type TaskRow = {
  id: string;
  reference: string;
  title: string;
  status: string;
  priority: string;
  request_type: string;
  progress_percent: number;
  branch_name: string | null;
  project: string | null;
  updated_at: string;
  created_at: string;
  completed_at: string | null;
  error_code: string | null;
};

export type Metrics = {
  total: number;
  in_flight: number;
  awaiting_approval: number;
  needs_information: number;
  completed_7d: number;
  failed_7d: number;
  median_minutes: number | null;
};

export type ApprovalRow = {
  id: string;
  task_id: string;
  reference: string;
  title: string;
  gate: 'plan' | 'merge' | 'production' | 'information';
  requested_at: string;
  project: string | null;
  status: string;
};

export type DeploymentRow = {
  id: string;
  environment: string;
  url: string | null;
  branch: string | null;
  commit_sha: string | null;
  status: string;
  provider: string | null;
  build_duration_seconds: number | null;
  started_at: string | null;
  finished_at: string | null;
};

export type AuditRow = {
  id: number;
  event_type: string;
  message: string | null;
  actor: string | null;
  task_id: string | null;
  created_at: string;
};

export type SourceRow = {
  id: string;
  name: string;
  api_key_prefix: string;
  ip_allowlist: string[];
  rate_limit_per_minute: number;
  state: string;
  last_used_at: string | null;
  task_count: number;
};

export type AgentTool = {
  tool_name: string;
  scope: string | null;
  grant_level: 'ALLOW' | 'LIMITED' | 'DENY';
};

export type AgentRun = {
  reference: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cost: number | null;
  duration_seconds: number | null;
  failover: boolean | null;
  model: string | null;
  created_at: string;
};

export type AgentDefinition = {
  id: string;
  key: string;
  display_name: string;
  stage_order: number;
  purpose: string | null;
  request_types: string[];
  enabled: boolean;
  optional_stage: boolean;
  terminal_stage: boolean;
  blocking: boolean;
  veto_power: boolean;
  may_self_approve: boolean;
  requires_approved_plan: boolean;
  system_prompt: string | null;
  inputs: Record<string, string>;
  outputs: Record<string, string>;
  checks: Record<string, string>;
  limits: Record<string, string | number | boolean>;
  platform_default: boolean;
  ai: Nullable<{
    primary_model: string | null;
    fallback_model: string | null;
    fallback_permitted: boolean | null;
    temperature: number | null;
    thinking_budget: string | null;
    context_strategy: string | null;
    response_format: string | null;
  }>;
  tools: AgentTool[];
  templates: Record<string, string>;
  runs: AgentRun[];
};

export type Usage = {
  month_cost: number;
  month_input_tokens: number;
  month_output_tokens: number;
  failover_calls: number;
  budget: number;
};

export type Connections = {
  github: Nullable<Record<string, unknown>>;
  deployment: Nullable<Record<string, unknown>>;
  ai: Record<string, unknown>[];
  secrets: {
    reference: string;
    used_by: string | null;
    rotated_at: string | null;
    rotation_days: number | null;
    revoked: boolean;
  }[];
  webhooks: {
    direction: string;
    path: string;
    note: string | null;
    replay_window_seconds: number | null;
    enabled: boolean;
  }[];
};

export type Overview = {
  platform_role: string;
  role: string;
  tenants: TenantSummary[];
  tenant: Nullable<Tenant>;
  members: Member[];
  projects: Project[];
  tasks: TaskRow[];
  metrics: Metrics;
  approvals: ApprovalRow[];
  deployments: DeploymentRow[];
  audit: AuditRow[];
  sources: SourceRow[];
  agents: AgentDefinition[];
  usage: Usage;
  connections: Connections;
};

const EMPTY_METRICS: Metrics = {
  total: 0,
  in_flight: 0,
  awaiting_approval: 0,
  needs_information: 0,
  completed_7d: 0,
  failed_7d: 0,
  median_minutes: null,
};

const EMPTY_USAGE: Usage = {
  month_cost: 0,
  month_input_tokens: 0,
  month_output_tokens: 0,
  failover_calls: 0,
  budget: 0,
};

const EMPTY_CONNECTIONS: Connections = {
  github: null,
  deployment: null,
  ai: [],
  secrets: [],
  webhooks: [],
};

/**
 * The tenant overview every screen draws from. Returns null only when the
 * account no longer exists or is suspended — an account with no tenants gets a
 * populated object with `tenant: null`, which the portal renders as an empty
 * control plane rather than an error.
 */
export async function loadOverview(
  userId: string,
  tenantSlug?: string | null,
): Promise<Overview | null> {
  const { data, error } = await serviceClient().rpc('agentsync_portal_overview', {
    p_user_id: userId,
    p_tenant_slug: tenantSlug ?? null,
  });
  if (error) throw error;

  const result = (data ?? {}) as Record<string, unknown>;
  if (result.ok !== true) return null;

  return {
    platform_role: (result.platform_role as string) ?? 'VIEWER',
    role: (result.role as string) ?? (result.platform_role as string) ?? 'VIEWER',
    tenants: (result.tenants as TenantSummary[]) ?? [],
    tenant: (result.tenant as Tenant) ?? null,
    members: (result.members as Member[]) ?? [],
    projects: (result.projects as Project[]) ?? [],
    tasks: (result.tasks as TaskRow[]) ?? [],
    metrics: (result.metrics as Metrics) ?? EMPTY_METRICS,
    approvals: (result.approvals as ApprovalRow[]) ?? [],
    deployments: (result.deployments as DeploymentRow[]) ?? [],
    audit: (result.audit as AuditRow[]) ?? [],
    sources: (result.sources as SourceRow[]) ?? [],
    agents: (result.agents as AgentDefinition[]) ?? [],
    usage: (result.usage as Usage) ?? EMPTY_USAGE,
    connections: (result.connections as Connections) ?? EMPTY_CONNECTIONS,
  };
}

/* ---- one task -------------------------------------------------------- */

export type TaskPlan = {
  version: number;
  summary: string | null;
  steps: unknown;
  assumptions: string[] | null;
  affected_files: string[] | null;
  testing_plan: string | null;
  rollback_plan: string | null;
  open_questions: string[] | null;
  complexity: string | null;
  created_at: string;
};

export type FileChange = {
  file_path: string;
  action: 'CREATED' | 'MODIFIED' | 'DELETED' | 'RENAMED';
  additions: number;
  deletions: number;
  checksum_after: string | null;
  created_at: string;
};

export type CommandRun = {
  command_type: string;
  command: string;
  exit_code: number | null;
  duration_seconds: number | null;
  attempt: number;
  result: 'PASSED' | 'FAILED' | 'REPAIRED' | 'SKIPPED';
  sanitised_output: string | null;
  error_summary: string | null;
};

export type Review = {
  verdict: 'submit' | 'changes' | 'reject';
  summary: string | null;
  criteria_matrix: unknown;
  findings: unknown;
  requires_human: boolean;
};

export type SecurityFinding = {
  severity: 'low' | 'medium' | 'high';
  category: string | null;
  file_path: string | null;
  line_number: number | null;
  description: string | null;
  blocking: boolean;
};

export type TaskEvent = {
  id: number;
  event_type: string;
  message: string | null;
  actor: string | null;
  created_at: string;
};

export type TaskDetail = {
  task: {
    id: string;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    request_type: string;
    external_reference: string | null;
    correlation_id: string;
    acceptance_criteria: string[] | null;
    requested_by: Record<string, unknown> | null;
    branch_name: string | null;
    commit_sha: string | null;
    pull_request_url: string | null;
    pull_request_number: number | null;
    result_summary: string | null;
    error_code: string | null;
    progress_percent: number | null;
    created_at: string;
    updated_at: string;
    completed_at: string | null;
  };
  project: Nullable<{ name: string; slug: string }>;
  source: string | null;
  plan: Nullable<TaskPlan>;
  files: FileChange[];
  commands: CommandRun[];
  review: Nullable<Review>;
  report: Nullable<Record<string, unknown>>;
  security_findings: SecurityFinding[];
  events: TaskEvent[];
  approvals: {
    gate: string;
    decision: string;
    decided_by_email: string | null;
    decided_by_role: string | null;
    comments: string | null;
    requested_at: string;
    decided_at: string | null;
  }[];
  usage: { input_tokens: number; output_tokens: number; cost: number; calls: number };
};

/** One task, or null when it does not exist or belongs to another tenant. */
export async function loadTask(
  userId: string,
  taskId: string,
): Promise<TaskDetail | null> {
  const { data, error } = await serviceClient().rpc('agentsync_portal_task', {
    p_user_id: userId,
    p_task_id: taskId,
  });
  if (error) throw error;

  const result = (data ?? {}) as Record<string, unknown>;
  if (result.ok !== true) return null;
  return result as unknown as TaskDetail;
}
