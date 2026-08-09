/**
 * Content for the public AgentSync site. Everything the marketing page renders
 * lives here so copy changes never require touching layout.
 */

export const ACCENT = '#7C9CF5';

export type Line = { text: string; color: string };

// The real contract of POST /api/v1/agent/tasks. The tenant is not in the body
// — it comes from the source-system key — so this stays accurate as written.
export const requestLines: Line[] = [
  { text: 'POST /api/v1/agent/tasks', color: '#F2F2F4' },
  { text: 'Authorization: Bearer ask_live_…', color: '#6A6A73' },
  { text: '', color: '#6A6A73' },
  { text: '{', color: '#6A6A73' },
  { text: '  "project_id": "41ad…77e0",', color: '#9A9AA3' },
  { text: '  "idempotency_key": "TICKET-1045",', color: ACCENT },
  { text: '  "request_type": "code_change",', color: '#9A9AA3' },
  { text: '  "title": "Add a status filter to the', color: '#F2F2F4' },
  { text: '            customer dashboard",', color: '#F2F2F4' },
  { text: '  "acceptance_criteria": [ … ],', color: '#9A9AA3' },
  { text: '  "priority": "normal",', color: '#9A9AA3' },
  { text: '  "callback_url": "https://…/callback"', color: '#9A9AA3' },
  { text: '}', color: '#6A6A73' },
  { text: '', color: '#6A6A73' },
  { text: '→ 202  task_id  correlation_id  status: queued', color: '#F5A623' },
  { text: '   same key again → 200, the original task', color: '#71717B' },
];

export const responseLines: Line[] = [
  { text: 'branch   ai/TICKET-1045-status-filter', color: '#9A9AA3' },
  { text: 'files    6 changed  +148 / −23', color: '#9A9AA3' },
  { text: 'lint     passed', color: '#6FD69C' },
  { text: 'typecheck passed', color: '#6FD69C' },
  { text: 'tests    passed  (1 repair cycle)', color: '#6FD69C' },
  { text: 'build    passed', color: '#6FD69C' },
  { text: 'pull request  #45 opened', color: ACCENT },
  { text: 'preview  …git-ai-ticket-1045.vercel.app', color: ACCENT },
  { text: '', color: '#6A6A73' },
  { text: 'status   awaiting_merge_approval', color: '#F5A623' },
  { text: '         held for a human · nothing merged', color: '#71717B' },
];

export const agents = [
  {
    n: '01',
    name: 'Orchestrator',
    text: 'Loads configuration, owns task state, enforces every limit and prevents duplicate work on retry.',
    out: 'STATE TRANSITIONS',
  },
  {
    n: '02',
    name: 'Planner',
    text: 'Reads the repository before assuming anything, then writes a plan with assumptions, risks and a test plan.',
    out: 'IMPLEMENTATION PLAN',
  },
  {
    n: '03',
    name: 'Coder',
    text: 'Implements only the approved plan, inside the allowed paths, on an isolated branch.',
    out: 'DIFF + FILE INVENTORY',
  },
  {
    n: '04',
    name: 'Reviewer',
    text: 'Checks the diff against acceptance criteria, looks for security problems and unrelated changes.',
    out: 'REVIEW VERDICT',
  },
  {
    n: '05',
    name: 'Validator',
    text: 'Runs your configured commands, interprets failures and authorises a bounded number of repairs.',
    out: 'VALIDATION REPORT',
  },
];

type StateKind = 'n' | 'w' | 'g' | 's' | 'f';

const STATE_THEME: Record<StateKind, [string, string, string]> = {
  n: ['#1A1A1D', '#9A9AA3', '#242428'],
  w: ['#132430', '#7FB6E0', '#1D3444'],
  g: ['#33240F', '#F5A623', '#4A3616'],
  s: ['#122E1E', '#6FD69C', '#1B4430'],
  f: ['#331515', '#F08A80', '#4A2020'],
};

const RAW_STATES: { name: string; k: StateKind }[] = [
  { name: 'received', k: 'n' },
  { name: 'validating', k: 'n' },
  { name: 'queued', k: 'n' },
  { name: 'analysing', k: 'w' },
  { name: 'planning', k: 'w' },
  { name: 'awaiting_plan_approval', k: 'g' },
  { name: 'implementing', k: 'w' },
  { name: 'testing', k: 'w' },
  { name: 'awaiting_merge_approval', k: 'g' },
  { name: 'creating_pull_request', k: 'w' },
  { name: 'deploying_preview', k: 'w' },
  { name: 'awaiting_production_approval', k: 'g' },
  { name: 'deploying_production', k: 'w' },
  { name: 'completed', k: 's' },
  { name: 'failed', k: 'f' },
  { name: 'cancelled', k: 'f' },
  { name: 'rolled_back', k: 'f' },
];

export const lifecycleStates = RAW_STATES.map((s) => {
  const [bg, fg, border] = STATE_THEME[s.k];
  return { name: s.name, bg, fg, border };
});

export const stateKey = [
  { label: 'Intake', color: '#9A9AA3' },
  { label: 'Agent working', color: '#7FB6E0' },
  { label: 'Human gate', color: '#F5A623' },
  { label: 'Terminal', color: '#6FD69C' },
];

export const denies = [
  'Delete a repository or disable branch protection',
  'Change organisation security or CI configuration outside an approved scope',
  'Push directly to a production branch unless the project explicitly allows it',
  'Merge its own pull request without a recorded human approval',
  'Deploy to production ahead of the configured approval',
  'Touch a protected path, or exceed the file and line-change limits',
  'Read a secret, or write one into a log, commit or pull-request body',
  'Reach a repository or tenant it was not configured for',
];

export const controls = [
  {
    title: 'Tenant isolation',
    text: 'Row-level security on every tenant table. Service-role access exists only inside trusted server-side workers, never in a browser.',
    tags: ['SUPABASE RLS', 'SCOPED KEYS', 'PER-TENANT AUDIT'],
  },
  {
    title: 'Least-privilege GitHub access',
    text: 'A GitHub App with contents and pull_requests write, everything else read or none. Tokens are minted per task and expire in under an hour.',
    tags: ['NO PATS', 'REPO ALLOWLIST', '55 MIN TTL'],
  },
  {
    title: 'Sandboxed execution',
    text: 'Commands come from the project configuration and must match the allowlist. No network egress during execution; the workspace is destroyed afterwards.',
    tags: ['COMMAND ALLOWLIST', 'NO EGRESS', 'TIME LIMIT'],
  },
  {
    title: 'Budgets and idempotency',
    text: 'Token, cost and execution ceilings per project. Retries never produce a second branch, pull request, deployment or callback.',
    tags: ['COST CAP', 'IDEMPOTENCY KEY', 'WORKER LOCKS'],
  },
];

export const configGroups = [
  {
    title: 'Repository',
    table: 'project_repositories',
    keys: [
      'github_owner',
      'default_branch',
      'branch_prefix',
      'protected_paths',
      'allowed_paths',
      'maximum_files_changed',
      'maximum_lines_changed',
    ],
  },
  {
    title: 'Runtime',
    table: 'project_runtime_configs',
    keys: [
      'package_manager',
      'install_command',
      'lint_command',
      'typecheck_command',
      'test_command',
      'build_command',
      'maximum_repair_attempts',
    ],
  },
  {
    title: 'AI routing',
    table: 'project_ai_configs',
    keys: [
      'primary_provider',
      'fallback_provider',
      'system_prompt',
      'coding_instructions',
      'maximum_input_tokens',
      'maximum_task_cost',
      'temperature',
    ],
  },
  {
    title: 'Policy',
    table: 'projects',
    keys: [
      'plan_approval_required',
      'merge_approval_required',
      'production_requires_approval',
      'agent_may_merge_own_pr',
      'direct_push_to_default',
      'callback_url',
      'rollback_policy',
    ],
  },
];

export const requestTypes = [
  {
    type: 'code_change',
    text: 'Features, fixes and small enhancements against an existing codebase.',
  },
  {
    type: 'refactor',
    text: 'Structural work with no behaviour change, held to the same test bar.',
  },
  {
    type: 'dependency_update',
    text: 'Version bumps, lockfile maintenance, deprecation cleanups.',
  },
  {
    type: 'migration',
    text: 'Schema and data migrations, gated harder than ordinary changes.',
  },
  {
    type: 'investigation',
    text: 'Read-only analysis that returns findings and opens nothing.',
  },
  {
    type: 'custom',
    text: 'Define your own type, with its own prompt, limits and approval policy.',
  },
];

export const integrations = [
  {
    name: 'GitHub',
    text: 'App-based access, isolated branches, pull requests with the full task record attached.',
    dot: '#6FD69C',
  },
  {
    name: 'Vercel',
    text: 'Deployments stay owned by the Git integration. AgentSync only listens and records.',
    dot: '#6FD69C',
  },
  {
    name: 'Supabase',
    text: 'Configuration, tasks, approvals and the immutable event log, isolated per tenant.',
    dot: '#6FD69C',
  },
  {
    name: 'Claude',
    text: 'Primary provider for planning, implementation and review.',
    dot: '#6FD69C',
  },
  {
    name: 'OpenAI',
    text: 'Fallback on temporary failure, and only where the project has opted in.',
    dot: '#F5A623',
  },
  {
    name: 'Your systems',
    text: 'Any source that can sign a request: service desk, intake portal, CRM, internal tool, cron job, another agent.',
    dot: '#7FB6E0',
  },
];

export const phases = [
  {
    n: 'P1',
    name: 'Foundation',
    text: 'Migrations, authentication, tenant and project configuration, submission API, state machine, audit events.',
    state: 'SPEC READY',
    bg: '#122E1E',
    fg: '#6FD69C',
  },
  {
    n: 'P2',
    name: 'Worker and planning',
    text: 'Queue, worker locking, repository checkout, Claude adapter, OpenAI fallback, plan approval.',
    state: 'SPEC READY',
    bg: '#122E1E',
    fg: '#6FD69C',
  },
  {
    n: 'P3',
    name: 'GitHub implementation',
    text: 'GitHub App, isolated branches, command runner, diff review, pull-request creation.',
    state: 'SPEC READY',
    bg: '#122E1E',
    fg: '#6FD69C',
  },
  {
    n: 'P4',
    name: 'Vercel and callbacks',
    text: 'GitHub and Vercel webhook handling, deployment tracking, signed callbacks with retries.',
    state: 'DESIGN',
    bg: '#33240F',
    fg: '#F5A623',
  },
  {
    n: 'P5',
    name: 'Management portal',
    text: 'Task dashboard, approval screens, configuration, audit history, usage and cost reporting.',
    state: 'DESIGN',
    bg: '#33240F',
    fg: '#F5A623',
  },
  {
    n: 'P6',
    name: 'Production hardening',
    text: 'Prompt-injection and concurrency testing, secret scanning, monitoring, backup and recovery.',
    state: 'PLANNED',
    bg: '#1A1A1D',
    fg: '#9A9AA3',
  },
];
