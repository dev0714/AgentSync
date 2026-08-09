/**
 * Fixture data for the AgentSync control plane.
 *
 * The portal is a front end over Supabase tables; until those are wired up the
 * screens read from here. Every group carries the table it maps to so the shape
 * stays honest about where the values will eventually come from.
 */

export const ACCENT = '#7C9CF5';

export const OK: [string, string] = ['#122E1E', '#6FD69C'];
export const WARN: [string, string] = ['#33240F', '#F5A623'];
export const OFF: [string, string] = ['#212125', '#9A9AA3'];
export const NO: [string, string] = ['#331515', '#F08A80'];
export const INFO: [string, string] = ['#132430', '#7FB6E0'];

export type Row = { key: string; value: string; color?: string };
export type Line = { text: string; color: string };

export function rows(pairs: [string, string, string?][]): Row[] {
  return pairs.map(([key, value, color]) => ({
    key,
    value,
    color: color ?? '#E6E6EA',
  }));
}

/* ---- tasks ---------------------------------------------------------- */

export const PILL: Record<string, [string, string]> = {
  completed: ['#122E1E', '#6FD69C'],
  failed: ['#331515', '#F08A80'],
  awaiting_merge_approval: ['#33240F', '#F0B45E'],
  awaiting_plan_approval: ['#33240F', '#F0B45E'],
  awaiting_production_approval: ['#33240F', '#F0B45E'],
  needs_information: ['#33240F', '#F0B45E'],
  implementing: ['#132430', '#7FB6E0'],
  analysing: ['#132430', '#7FB6E0'],
  planning: ['#132430', '#7FB6E0'],
  testing: ['#132430', '#7FB6E0'],
  deploying_preview: ['#132430', '#7FB6E0'],
  queued: ['#212125', '#9A9AA3'],
  received: ['#212125', '#9A9AA3'],
  cancelled: ['#212125', '#9A9AA3'],
  rolled_back: ['#212125', '#9A9AA3'],
};

export type Task = {
  ref: string;
  title: string;
  project: string;
  priority: string;
  status: string;
  pct: number;
  branch: string;
  updated: string;
};

export const TASKS: Task[] = [
  {
    ref: 'TICKET-1045',
    title: 'Add a status filter to the customer dashboard',
    project: 'Customer Portal',
    priority: 'normal',
    status: 'awaiting_merge_approval',
    pct: 90,
    branch: 'ai/TICKET-1045-status-filter',
    updated: '2m ago',
  },
  {
    ref: 'TICKET-1042',
    title: 'Invoice PDF totals exclude discount lines',
    project: 'Billing Service',
    priority: 'high',
    status: 'implementing',
    pct: 55,
    branch: 'ai/TICKET-1042-invoice-totals',
    updated: '4m ago',
  },
  {
    ref: 'SOW-0311',
    title: 'Migrate onboarding wizard to server actions',
    project: 'Customer Portal',
    priority: 'normal',
    status: 'awaiting_plan_approval',
    pct: 30,
    branch: '—',
    updated: '11m ago',
  },
  {
    ref: 'TICKET-1039',
    title: 'Add rate limiting to the public search endpoint',
    project: 'API Gateway',
    priority: 'high',
    status: 'testing',
    pct: 70,
    branch: 'ai/TICKET-1039-rate-limit',
    updated: '18m ago',
  },
  {
    ref: 'TICKET-1036',
    title: 'Fix timezone drift on scheduled reports',
    project: 'Reporting',
    priority: 'low',
    status: 'failed',
    pct: 45,
    branch: 'ai/TICKET-1036-tz-drift',
    updated: '32m ago',
  },
  {
    ref: 'TICKET-1034',
    title: 'Expose deployment health on the ops page',
    project: 'Ops Console',
    priority: 'normal',
    status: 'awaiting_production_approval',
    pct: 95,
    branch: 'ai/TICKET-1034-health-widget',
    updated: '48m ago',
  },
  {
    ref: 'SOW-0308',
    title: 'Split tenant settings into its own table',
    project: 'Billing Service',
    priority: 'normal',
    status: 'needs_information',
    pct: 25,
    branch: '—',
    updated: '1h ago',
  },
  {
    ref: 'TICKET-1031',
    title: 'Support pending status in the customers API',
    project: 'API Gateway',
    priority: 'normal',
    status: 'completed',
    pct: 100,
    branch: 'ai/TICKET-1031-pending-status',
    updated: '2h ago',
  },
  {
    ref: 'TICKET-1028',
    title: 'Cache the dashboard summary query',
    project: 'Customer Portal',
    priority: 'low',
    status: 'completed',
    pct: 100,
    branch: 'ai/TICKET-1028-summary-cache',
    updated: '3h ago',
  },
  {
    ref: 'TICKET-1024',
    title: 'Remove unused feature flag helpers',
    project: 'Reporting',
    priority: 'low',
    status: 'cancelled',
    pct: 20,
    branch: 'ai/TICKET-1024-flag-cleanup',
    updated: '5h ago',
  },
];

export type FilterKey = 'all' | 'gate' | 'running' | 'failed' | 'completed';

export const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'gate', label: 'Awaiting approval' },
  { key: 'running', label: 'Running' },
  { key: 'failed', label: 'Failed' },
  { key: 'completed', label: 'Completed' },
];

export function matchesFilter(task: Task, filter: FilterKey): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'gate':
      return (
        task.status.startsWith('awaiting') || task.status === 'needs_information'
      );
    case 'running':
      return [
        'analysing',
        'planning',
        'implementing',
        'testing',
        'deploying_preview',
        'queued',
        'received',
      ].includes(task.status);
    case 'failed':
      return task.status === 'failed';
    case 'completed':
      return task.status === 'completed';
  }
}

export const METRICS = [
  {
    label: 'RECEIVED · 24H',
    value: '38',
    delta: '+9 vs yesterday',
    deltaColor: '#9A9AA3',
  },
  {
    label: 'MERGED',
    value: '21',
    delta: '55% of received',
    deltaColor: '#9A9AA3',
  },
  {
    label: 'AT A GATE',
    value: '4',
    delta: 'oldest waiting 41m',
    deltaColor: '#F0B45E',
  },
  {
    label: 'FAILED',
    value: '3',
    delta: '2 build, 1 provider',
    deltaColor: '#F08A80',
  },
  {
    label: 'MEDIAN CYCLE',
    value: '18m',
    delta: 'queue wait 42s',
    deltaColor: '#9A9AA3',
  },
];

/* ---- task detail ---------------------------------------------------- */

export const DETAIL = {
  ref: 'TICKET-1045',
  correlation: '9f3c1a80',
  title: 'Add a status filter to the customer dashboard',
  planSummary:
    'Add a status dropdown above the existing customer table and pass the selection through the existing query hook. The table already reads from useCustomerQuery, so the filter can be added as a query parameter rather than a client-side pass over the result set. No database change is required — status is already a column on customers with a check constraint covering active, inactive and pending.',
  rollback:
    'Single squashed commit on ai/TICKET-1045-status-filter. Revert the merge commit and redeploy; no migration or data change to unwind.',
  description:
    'Allow users to filter customers by active, inactive, and pending status.',
  additions: '148',
  deletions: '23',
  limitLabel: '6 OF 20 FILES · 171 OF 400 LINES',
  review:
    'Acceptance criteria 1–4 all satisfied. Changes are confined to the allowed paths. No secrets, no dependency additions, no unrelated refactoring. Mobile layout verified against the existing breakpoint tokens. Safe to submit.',
  budgetPct: '34%',
};

export const PLAN_STEPS = [
  {
    n: '01',
    text: 'Add a StatusFilter component beside the existing search input in CustomerToolbar.',
  },
  {
    n: '02',
    text: 'Extend the customers query schema with an optional status enum, validated with Zod.',
  },
  {
    n: '03',
    text: 'Thread the value through useCustomerQuery so search and status compose.',
  },
  {
    n: '04',
    text: 'Collapse the control into the existing filter sheet below the sm breakpoint.',
  },
  {
    n: '05',
    text: 'Add unit tests for the query builder and a Playwright case for combined filters.',
  },
];

export const ASSUMPTIONS = [
  'Status values are limited to active, inactive and pending as constrained in the database.',
  'Filtering happens server-side, consistent with the existing search behaviour.',
  'No new dependency is needed; the design system already ships a Select.',
];

export const FILES = [
  {
    action: 'MODIFIED',
    path: 'src/components/customers/CustomerToolbar.tsx',
    add: '48',
    del: '6',
    addW: 38,
    delW: 5,
    actionFg: '#7FB6E0',
  },
  {
    action: 'CREATED',
    path: 'src/components/customers/StatusFilter.tsx',
    add: '61',
    del: '0',
    addW: 48,
    delW: 0,
    actionFg: '#6FD69C',
  },
  {
    action: 'MODIFIED',
    path: 'src/lib/queries/customers.ts',
    add: '19',
    del: '11',
    addW: 16,
    delW: 9,
    actionFg: '#7FB6E0',
  },
  {
    action: 'MODIFIED',
    path: 'src/lib/schemas/customer-query.ts',
    add: '9',
    del: '2',
    addW: 8,
    delW: 2,
    actionFg: '#7FB6E0',
  },
  {
    action: 'CREATED',
    path: 'src/lib/queries/customers.test.ts',
    add: '7',
    del: '0',
    addW: 6,
    delW: 0,
    actionFg: '#6FD69C',
  },
  {
    action: 'MODIFIED',
    path: 'e2e/customers.spec.ts',
    add: '4',
    del: '4',
    addW: 4,
    delW: 4,
    actionFg: '#7FB6E0',
  },
];

export const COMMANDS = [
  {
    type: 'INSTALL',
    cmd: 'pnpm install --frozen-lockfile',
    exit: '0',
    dur: '31s',
    status: 'PASSED',
    c: OK,
  },
  { type: 'LINT', cmd: 'pnpm lint', exit: '0', dur: '12s', status: 'PASSED', c: OK },
  {
    type: 'TYPECHECK',
    cmd: 'pnpm typecheck',
    exit: '0',
    dur: '19s',
    status: 'PASSED',
    c: OK,
  },
  {
    type: 'TEST',
    cmd: 'pnpm test -- --run',
    exit: '0',
    dur: '1m 04s',
    status: 'PASSED',
    c: OK,
  },
  {
    type: 'TEST (attempt 1)',
    cmd: 'pnpm test -- --run',
    exit: '1',
    dur: '58s',
    status: 'REPAIRED',
    c: ['#33240F', '#F0B45E'] as [string, string],
  },
  {
    type: 'BUILD',
    cmd: 'pnpm build',
    exit: '0',
    dur: '1m 22s',
    status: 'PASSED',
    c: OK,
  },
];

export const LOG_LINES: Line[] = [
  { text: '▲ Next.js 15.4.2  ·  compiling for production', color: '#9A9AA3' },
  { text: '✓ Compiled successfully in 41.2s', color: '#6FD69C' },
  { text: '✓ Linting and checking validity of types', color: '#6FD69C' },
  {
    text: '  Route (app)                     Size    First Load JS',
    color: '#71717B',
  },
  {
    text: '  ├ ○ /customers                 6.1 kB        142 kB',
    color: '#9A9AA3',
  },
  {
    text: '  └ ○ /customers/[id]            4.4 kB        139 kB',
    color: '#9A9AA3',
  },
  {
    text: '✓ Build completed  ·  exit 0  ·  workspace destroyed',
    color: '#6FD69C',
  },
];

export const CRITERIA = [
  'A status dropdown must appear above the customer table',
  'The selected status must filter the displayed records',
  'The filter must work on desktop and mobile',
  'Existing customer search must continue working',
];

export const PAYLOAD_LINES: Line[] = [
  { text: '{', color: '#9A9AA3' },
  { text: '  "tenant_id": "8c1f…9ab2",', color: '#9A9AA3' },
  { text: '  "project_id": "41ad…77e0",', color: '#9A9AA3' },
  { text: '  "external_reference": "TICKET-1045",', color: '#6FD69C' },
  { text: '  "request_type": "code_change",', color: '#6FD69C' },
  { text: '  "priority": "normal",', color: '#9A9AA3' },
  { text: '  "requested_by": {', color: '#9A9AA3' },
  { text: '    "id": "user-123",', color: '#9A9AA3' },
  { text: '    "name": "Andre"', color: '#9A9AA3' },
  { text: '  },', color: '#9A9AA3' },
  { text: '  "callback_url": "https://…/agent-callback",', color: '#9A9AA3' },
  { text: '  "idempotency_key": "TICKET-1045:v1"', color: '#F5A623' },
  { text: '}', color: '#9A9AA3' },
  { text: '', color: '#71717B' },
  { text: '× signature verified  × replay window 300s', color: '#71717B' },
];

export const EVENTS = [
  {
    time: '08:00:04',
    type: 'TASK_RECEIVED',
    message:
      'Accepted from Jira Sync · signature valid · idempotency key new',
    dot: '#6A6A73',
  },
  {
    time: '08:00:05',
    type: 'TASK_QUEUED',
    message: 'Enqueued at normal priority · queue depth 3',
    dot: '#6A6A73',
  },
  {
    time: '08:00:47',
    type: 'WORKER_CLAIMED',
    message: 'worker-2 acquired lock · expires 08:30:47',
    dot: '#7FB6E0',
  },
  {
    time: '08:01:12',
    type: 'REPO_ANALYSED',
    message: 'Read 41 files · found AGENTS.md, pnpm-lock.yaml, 3 related tests',
    dot: '#7FB6E0',
  },
  {
    time: '08:03:20',
    type: 'PLAN_CREATED',
    message: 'claude-sonnet-4-6 · plan v2 · 5 steps · moderate complexity',
    dot: '#7FB6E0',
  },
  {
    time: '08:04:02',
    type: 'PLAN_APPROVED',
    message: 'Approved by Andre B. (APPROVER) — no comments',
    dot: '#4ADE80',
  },
  {
    time: '08:04:09',
    type: 'BRANCH_CREATED',
    message: 'ai/TICKET-1045-status-filter from main @ 4e91c02',
    dot: '#7FB6E0',
  },
  {
    time: '08:09:41',
    type: 'CHANGES_WRITTEN',
    message: '6 files · +148 / −23 · within configured limits',
    dot: '#7FB6E0',
  },
  {
    time: '08:12:03',
    type: 'VALIDATION_FAILED',
    message: 'pnpm test exit 1 · repair attempt 1 of 2 authorised',
    dot: '#F0B45E',
  },
  {
    time: '08:15:18',
    type: 'VALIDATION_PASSED',
    message: 'lint · typecheck · test · build all green',
    dot: '#4ADE80',
  },
  {
    time: '08:16:02',
    type: 'PULL_REQUEST_OPENED',
    message: 'PR #45 opened · reviewers requested from CODEOWNERS',
    dot: '#4ADE80',
  },
  {
    time: '08:17:44',
    type: 'PREVIEW_DEPLOYED',
    message: 'Vercel preview ready · dpl_7Kq2… · 1m 26s build',
    dot: '#4ADE80',
  },
  {
    time: '08:18:00',
    type: 'AWAITING_MERGE_APPROVAL',
    message: 'Gate held · merge approval required by project policy',
    dot: '#F0654A',
  },
];

export const STAGES = [
  {
    label: 'Received & authenticated',
    meta: '08:00',
    ring: '#4ADE80',
    fill: '#4ADE80',
    fg: '#C6C6CD',
  },
  {
    label: 'Repository analysed',
    meta: '08:01',
    ring: '#4ADE80',
    fill: '#4ADE80',
    fg: '#C6C6CD',
  },
  {
    label: 'Plan approved',
    meta: '08:04',
    ring: '#4ADE80',
    fill: '#4ADE80',
    fg: '#C6C6CD',
  },
  {
    label: 'Changes implemented',
    meta: '08:09',
    ring: '#4ADE80',
    fill: '#4ADE80',
    fg: '#C6C6CD',
  },
  {
    label: 'Validation passed',
    meta: '08:15',
    ring: '#4ADE80',
    fill: '#4ADE80',
    fg: '#C6C6CD',
  },
  {
    label: 'Preview deployed',
    meta: '08:17',
    ring: '#4ADE80',
    fill: '#4ADE80',
    fg: '#C6C6CD',
  },
  {
    label: 'Merge approval',
    meta: 'waiting',
    ring: '#F0654A',
    fill: '#33240F',
    fg: '#F0B45E',
  },
  {
    label: 'Production deploy',
    meta: 'blocked',
    ring: '#2E2E33',
    fill: '#0A0A0B',
    fg: '#55555D',
  },
];

export const ARTEFACTS = [
  { label: 'BRANCH', value: 'ai/TICKET-1045-status-filter', color: '#E6E6EA' },
  { label: 'COMMIT', value: 'abc123f', color: '#E6E6EA' },
  {
    label: 'PULL REQUEST',
    value: 'northwind/customer-portal#45',
    color: '#7C9CF5',
  },
  {
    label: 'PREVIEW',
    value: 'customer-portal-git-ai-ticket-1045.vercel.app',
    color: '#7C9CF5',
  },
  { label: 'WORKSPACE', value: 'destroyed after run', color: '#6A6A73' },
];

export const USAGE_ROWS = [
  { label: 'Provider', value: 'anthropic · primary' },
  { label: 'Model', value: 'claude-sonnet-4-6' },
  { label: 'Input tokens', value: '182,400' },
  { label: 'Output tokens', value: '31,970' },
  { label: 'Failovers', value: '0' },
  { label: 'Estimated cost', value: '$0.68 / $2.00' },
];

export const GUARDRAILS_HELD = [
  'Protected paths untouched: .github/, supabase/migrations/, infra/',
  'Commands restricted to the project allowlist; network egress blocked during execution',
  'Ticket text and repo files treated as untrusted; 1 injection attempt in a code comment ignored and logged',
  'Agent cannot merge its own pull request under this project policy',
];

/* ---- approvals, deployments, audit ---------------------------------- */

export type DetailTab = 'plan' | 'diff' | 'checks' | 'request' | 'events';

export const APPROVALS: {
  gate: string;
  gateC: [string, string];
  ref: string;
  waiting: string;
  title: string;
  detail: string;
  tab: DetailTab;
}[] = [
  {
    gate: 'MERGE',
    gateC: ['#33240F', '#F0B45E'],
    ref: 'TICKET-1045',
    waiting: '2m',
    title: 'Add a status filter to the customer dashboard',
    detail:
      'All checks green · preview live · 6 files, +148/−23 · reviewed by the review agent',
    tab: 'diff',
  },
  {
    gate: 'PLAN',
    gateC: ['#33240F', '#F0B45E'],
    ref: 'SOW-0311',
    waiting: '11m',
    title: 'Migrate onboarding wizard to server actions',
    detail:
      'Plan touches 14 files and one shared layout · flagged as high deployment risk',
    tab: 'plan',
  },
  {
    gate: 'PRODUCTION',
    gateC: ['#331515', '#F08A80'],
    ref: 'TICKET-1034',
    waiting: '48m',
    title: 'Expose deployment health on the ops page',
    detail:
      'Merged to main · production deploy held pending approval per project policy',
    tab: 'checks',
  },
  {
    gate: 'INFORMATION',
    gateC: ['#212125', '#9A9AA3'],
    ref: 'SOW-0308',
    waiting: '1h',
    title: 'Split tenant settings into its own table',
    detail:
      'Agent stopped: scope conflicts with an existing migration. Two questions raised.',
    tab: 'plan',
  },
];

export const DEPLOYMENTS = [
  {
    env: 'PREVIEW',
    envC: INFO,
    url: 'customer-portal-git-ai-ticket-1045.vercel.app',
    branch: 'ai/TICKET-1045-status-filter',
    commit: 'abc123f',
    status: 'READY',
    c: OK,
    build: '1m 26s',
    started: '08:17',
  },
  {
    env: 'PREVIEW',
    envC: INFO,
    url: 'api-gateway-git-ai-ticket-1039.vercel.app',
    branch: 'ai/TICKET-1039-rate-limit',
    commit: '7d40e11',
    status: 'BUILDING',
    c: INFO,
    build: '48s',
    started: '08:24',
  },
  {
    env: 'PRODUCTION',
    envC: ['#33240F', '#F0B45E'] as [string, string],
    url: 'ops.northwind.example.com',
    branch: 'main',
    commit: '2fa9c83',
    status: 'AWAITING_APPROVAL',
    c: ['#33240F', '#F0B45E'] as [string, string],
    build: '—',
    started: '07:36',
  },
  {
    env: 'PREVIEW',
    envC: INFO,
    url: 'reporting-git-ai-ticket-1036.vercel.app',
    branch: 'ai/TICKET-1036-tz-drift',
    commit: 'b81c400',
    status: 'ERROR',
    c: NO,
    build: '33s',
    started: '07:52',
  },
  {
    env: 'PRODUCTION',
    envC: ['#33240F', '#F0B45E'] as [string, string],
    url: 'api.northwind.example.com',
    branch: 'main',
    commit: 'e5c1d92',
    status: 'READY',
    c: OK,
    build: '2m 11s',
    started: '06:14',
  },
  {
    env: 'PREVIEW',
    envC: INFO,
    url: 'customer-portal-git-ai-ticket-1028.vercel.app',
    branch: 'ai/TICKET-1028-summary-cache',
    commit: '44b7f10',
    status: 'READY',
    c: OK,
    build: '1m 09s',
    started: '05:41',
  },
  {
    env: 'ROLLBACK',
    envC: OFF,
    url: 'billing-git-revert-1019.vercel.app',
    branch: 'ai/rollback-TICKET-1019',
    commit: '90ac2be',
    status: 'READY',
    c: OK,
    build: '1m 44s',
    started: 'Aug 3',
  },
];

export const AUDIT_LINES = [
  {
    time: '08:18:00',
    type: 'task.status_changed',
    typeColor: '#F5A623',
    detail:
      'TICKET-1045 testing → awaiting_merge_approval · worker-2 · corr 9f3c1a80',
  },
  {
    time: '08:17:44',
    type: 'deployment.updated',
    typeColor: '#6FD69C',
    detail:
      'dpl_7Kq2Lm status=READY env=preview branch=ai/TICKET-1045-status-filter',
  },
  {
    time: '08:16:02',
    type: 'github.pull_request',
    typeColor: '#6FD69C',
    detail:
      'opened #45 northwind/customer-portal by agentsync[bot] installation 41290',
  },
  {
    time: '08:15:18',
    type: 'validation.passed',
    typeColor: '#6FD69C',
    detail: 'lint=0 typecheck=0 test=0 build=0 attempts=2/2',
  },
  {
    time: '08:12:03',
    type: 'validation.failed',
    typeColor: '#F08A80',
    detail: 'command=pnpm test exit=1 repair_authorised=true attempt=1',
  },
  {
    time: '08:11:58',
    type: 'security.injection_ignored',
    typeColor: '#F08A80',
    detail:
      'untrusted instruction in src/legacy/notes.ts:44 · not executed · quarantined',
  },
  {
    time: '08:09:41',
    type: 'task.files_changed',
    typeColor: '#9A9AA3',
    detail: '6 files +148 −23 within limits max_files=20 max_lines=400',
  },
  {
    time: '08:04:09',
    type: 'github.branch_created',
    typeColor: '#9A9AA3',
    detail: 'ai/TICKET-1045-status-filter base=main sha=4e91c02',
  },
  {
    time: '08:04:02',
    type: 'approval.granted',
    typeColor: '#6FD69C',
    detail: 'type=plan task=TICKET-1045 actor=andre@example.com role=APPROVER',
  },
  {
    time: '08:03:20',
    type: 'ai.completion',
    typeColor: '#9A9AA3',
    detail:
      'provider=anthropic model=claude-sonnet-4-6 in=182400 out=31970 cost=$0.68',
  },
  {
    time: '08:01:12',
    type: 'repo.analysed',
    typeColor: '#9A9AA3',
    detail:
      'files_read=41 agents_md=true lockfile=pnpm workspace=/tmp/ws-9f3c1a80',
  },
  {
    time: '08:00:47',
    type: 'worker.lock_acquired',
    typeColor: '#9A9AA3',
    detail: 'worker-2 task=TICKET-1045 lock_expires=08:30:47',
  },
  {
    time: '08:00:05',
    type: 'task.queued',
    typeColor: '#9A9AA3',
    detail: 'priority=normal queue_depth=3 idempotency_key=TICKET-1045:v1',
  },
  {
    time: '08:00:04',
    type: 'auth.request_accepted',
    typeColor: '#9A9AA3',
    detail: 'source=jira-sync signature=valid skew=1.2s ip=41.20.8.14 allowlisted',
  },
  {
    time: '07:59:11',
    type: 'auth.request_rejected',
    typeColor: '#F08A80',
    detail:
      'source=legacy-crm reason=DUPLICATE_REQUEST idempotency_key=TICKET-1044:v1',
  },
];

/* ---- project configuration ------------------------------------------ */

export type Group = { title: string; table: string; rows: Row[] };

export const PROJECT_GROUPS: Group[] = [
  {
    title: 'Repository',
    table: 'project_repositories',
    rows: [
      {
        key: 'github_owner / repository',
        value: 'northwind / customer-portal',
        color: '#E6E6EA',
      },
      { key: 'default_branch', value: 'main', color: '#E6E6EA' },
      { key: 'branch_prefix', value: 'ai/', color: '#E6E6EA' },
      { key: 'installation_id', value: '41290 · GitHub App', color: '#E6E6EA' },
      { key: 'pull_requests_required', value: 'true', color: '#6FD69C' },
      {
        key: 'protected_paths',
        value: '.github/**, supabase/migrations/**, infra/**, *.env*',
        color: '#F08A80',
      },
      {
        key: 'allowed_paths',
        value: 'src/**, e2e/**, tests/**',
        color: '#E6E6EA',
      },
      { key: 'maximum_files_changed', value: '20', color: '#E6E6EA' },
      { key: 'maximum_lines_changed', value: '400', color: '#E6E6EA' },
    ],
  },
  {
    title: 'Runtime & validation',
    table: 'project_runtime_configs',
    rows: [
      {
        key: 'framework / runtime',
        value: 'nextjs · node 22',
        color: '#E6E6EA',
      },
      { key: 'package_manager', value: 'pnpm', color: '#E6E6EA' },
      {
        key: 'install_command',
        value: 'pnpm install --frozen-lockfile',
        color: '#E6E6EA',
      },
      { key: 'lint_command', value: 'pnpm lint', color: '#E6E6EA' },
      { key: 'typecheck_command', value: 'pnpm typecheck', color: '#E6E6EA' },
      { key: 'test_command', value: 'pnpm test -- --run', color: '#E6E6EA' },
      { key: 'build_command', value: 'pnpm build', color: '#E6E6EA' },
      { key: 'maximum_execution_minutes', value: '25', color: '#E6E6EA' },
      { key: 'maximum_repair_attempts', value: '2', color: '#E6E6EA' },
    ],
  },
  {
    title: 'AI routing',
    table: 'project_ai_configs',
    rows: [
      {
        key: 'primary_provider / model',
        value: 'anthropic · claude-sonnet-4-6',
        color: '#E6E6EA',
      },
      {
        key: 'fallback_provider / model',
        value: 'openai · gpt-5.1 (permitted)',
        color: '#E6E6EA',
      },
      { key: 'maximum_input_tokens', value: '400,000', color: '#E6E6EA' },
      { key: 'maximum_output_tokens', value: '64,000', color: '#E6E6EA' },
      { key: 'maximum_task_cost', value: '$2.00', color: '#E6E6EA' },
      { key: 'temperature', value: '0.2', color: '#E6E6EA' },
      {
        key: 'system_prompt',
        value: '2,140 chars · edited 2 Aug by Andre B.',
        color: '#7C9CF5',
      },
      {
        key: 'coding_instructions',
        value: 'AGENTS.md in repo takes precedence',
        color: '#7C9CF5',
      },
    ],
  },
  {
    title: 'Approval policy',
    table: 'projects',
    rows: [
      { key: 'plan_approval_required', value: 'true', color: '#6FD69C' },
      { key: 'merge_approval_required', value: 'true', color: '#6FD69C' },
      { key: 'production_requires_approval', value: 'true', color: '#6FD69C' },
      { key: 'agent_may_merge_own_pr', value: 'false', color: '#F08A80' },
      { key: 'direct_push_to_default', value: 'false', color: '#F08A80' },
      {
        key: 'callback_url',
        value: 'https://jira-sync.northwind…/agent-callback',
        color: '#7C9CF5',
      },
      {
        key: 'callback_signing_secret',
        value: 'secret://northwind/jira-sync/hmac',
        color: '#6A6A73',
      },
      {
        key: 'rollback_policy',
        value: 'revert commit · new PR · human merge',
        color: '#E6E6EA',
      },
    ],
  },
];

/* ---- source systems, usage ------------------------------------------ */

export const SOURCES = [
  {
    name: 'Jira Sync',
    tenant: 'northwind',
    key: 'ask_live_9f3c…',
    ips: '41.20.8.0/24',
    rate: '120 / min',
    state: 'ACTIVE',
    c: OK,
  },
  {
    name: 'Client Intake Portal',
    tenant: 'northwind',
    key: 'ask_live_2b71…',
    ips: 'any',
    rate: '30 / min',
    state: 'ACTIVE',
    c: OK,
  },
  {
    name: 'Meridian Service Desk',
    tenant: 'meridian-health',
    key: 'ask_live_c40d…',
    ips: '196.11.4.0/28',
    rate: '60 / min',
    state: 'ACTIVE',
    c: OK,
  },
  {
    name: 'Legacy CRM',
    tenant: 'northwind',
    key: 'ask_live_81ae…',
    ips: '41.20.9.11',
    rate: '10 / min',
    state: 'DISABLED',
    c: NO,
  },
  {
    name: 'Cape Logistics Ops',
    tenant: 'cape-logistics',
    key: 'ask_test_5db2…',
    ips: 'any',
    rate: '15 / min',
    state: 'TEST',
    c: OFF,
  },
];

export const USAGE_CARDS = [
  { label: 'SPEND · AUGUST', value: '$248.10', sub: 'of $900 tenant cap' },
  { label: 'TOKENS', value: '61.4M', sub: '52.8M in · 8.6M out' },
  {
    label: 'COST PER MERGED TASK',
    value: '$1.18',
    sub: 'down from $1.44 in July',
  },
  { label: 'PROVIDER FAILOVERS', value: '3', sub: 'all recovered on OpenAI' },
];

export const SPEND_ROWS = [
  { name: 'Customer Portal', pct: '78%', cost: '$96.40', cap: '/ $120', color: ACCENT },
  { name: 'API Gateway', pct: '54%', cost: '$64.80', cap: '/ $120', color: ACCENT },
  {
    name: 'Billing Service',
    pct: '41%',
    cost: '$41.20',
    cap: '/ $100',
    color: ACCENT,
  },
  { name: 'Reporting', pct: '92%', cost: '$27.60', cap: '/ $30', color: '#F0654A' },
  { name: 'Ops Console', pct: '22%', cost: '$13.10', cap: '/ $60', color: ACCENT },
  {
    name: 'Internal · AgentSync',
    pct: '10%',
    cost: '$5.00',
    cap: '/ $50',
    color: ACCENT,
  },
];

/* ---- connections ---------------------------------------------------- */

export type ConnTab =
  | 'overview'
  | 'github'
  | 'vercel'
  | 'supabase'
  | 'ai'
  | 'webhooks'
  | 'secrets';

export const CONN_TABS: { k: ConnTab; label: string; dot: string }[] = [
  { k: 'overview', label: 'Overview', dot: 'transparent' },
  { k: 'github', label: 'GitHub', dot: '#4ADE80' },
  { k: 'vercel', label: 'Vercel', dot: '#4ADE80' },
  { k: 'supabase', label: 'Supabase', dot: '#4ADE80' },
  { k: 'ai', label: 'AI providers', dot: '#F5A623' },
  { k: 'webhooks', label: 'Webhooks', dot: '#4ADE80' },
  { k: 'secrets', label: 'Secrets', dot: '#F0654A' },
];

export const CONN_TILES = [
  {
    name: 'GitHub App',
    target: 'agentsync[bot] · installation 41290',
    meta: '3 repositories · token minted per task, 55 min TTL',
    state: 'CONNECTED',
    dot: '#4ADE80',
    c: OK,
  },
  {
    name: 'Vercel',
    target: 'team_northwind · git integration',
    meta: '4 projects linked · preview + production hooks active',
    state: 'CONNECTED',
    dot: '#4ADE80',
    c: OK,
  },
  {
    name: 'Supabase',
    target: 'db.agentsync-prod · eu-west-1',
    meta: 'RLS on all tenant tables · service role scoped to workers',
    state: 'CONNECTED',
    dot: '#4ADE80',
    c: OK,
  },
  {
    name: 'Anthropic',
    target: 'claude-sonnet-4-6 · primary provider',
    meta: 'p50 latency 2.1s · 0 errors in 24h',
    state: 'CONNECTED',
    dot: '#4ADE80',
    c: OK,
  },
  {
    name: 'OpenAI',
    target: 'gpt-5.1 · fallback provider',
    meta: '3 failovers this month · per-project opt-in required',
    state: 'STANDBY',
    dot: '#F5A623',
    c: ['#33240F', '#F0B45E'] as [string, string],
  },
  {
    name: 'Secret manager',
    target: 'secret://northwind/*',
    meta: '14 references · 1 rotation overdue',
    state: 'ATTENTION',
    dot: '#F0654A',
    c: ['#33240F', '#F0B45E'] as [string, string],
  },
];

export const CONN_CARDS: {
  k: ConnTab;
  title: string;
  scope: string;
  rows: Row[];
}[] = [
  {
    k: 'github',
    title: 'GitHub',
    scope: 'github_app_installations',
    rows: [
      {
        key: 'auth_mode',
        value: 'github_app (no PATs stored)',
        color: '#6FD69C',
      },
      { key: 'app_slug', value: 'agentsync', color: '#E6E6EA' },
      { key: 'installation_id', value: '41290', color: '#E6E6EA' },
      {
        key: 'private_key_reference',
        value: 'secret://agentsync/github/app-key',
        color: '#6A6A73',
      },
      {
        key: 'webhook_secret_reference',
        value: 'secret://agentsync/github/webhook',
        color: '#6A6A73',
      },
      {
        key: 'repository_allowlist',
        value: 'customer-portal, api-gateway, billing-service',
        color: '#E6E6EA',
      },
      {
        key: 'token_ttl',
        value: '55 minutes · minted per task',
        color: '#E6E6EA',
      },
      { key: 'branch_protection_writes', value: 'denied', color: '#F08A80' },
    ],
  },
  {
    k: 'vercel',
    title: 'Vercel',
    scope: 'deployment_providers',
    rows: [
      {
        key: 'integration',
        value: 'git integration (deploys owned by GitHub)',
        color: '#E6E6EA',
      },
      { key: 'team_id', value: 'team_northwind', color: '#E6E6EA' },
      { key: 'linked_projects', value: '4 of 6 projects', color: '#E6E6EA' },
      {
        key: 'api_token_reference',
        value: 'secret://agentsync/vercel/read-token',
        color: '#6A6A73',
      },
      { key: 'token_scope', value: 'read deployments only', color: '#6FD69C' },
      {
        key: 'preview_on',
        value: 'pull_request + branch push',
        color: '#E6E6EA',
      },
      {
        key: 'production_trigger',
        value: 'merge to main, after approval',
        color: '#E6E6EA',
      },
      { key: 'promote_via_api', value: 'disabled', color: '#F08A80' },
    ],
  },
  {
    k: 'supabase',
    title: 'Supabase',
    scope: 'platform',
    rows: [
      { key: 'project_ref', value: 'agentsync-prod', color: '#E6E6EA' },
      { key: 'region', value: 'eu-west-1', color: '#E6E6EA' },
      {
        key: 'anon_key_usage',
        value: 'portal only, RLS enforced',
        color: '#E6E6EA',
      },
      {
        key: 'service_role_usage',
        value: 'workers only, never in browser',
        color: '#F08A80',
      },
      { key: 'rls_coverage', value: '14 of 14 tenant tables', color: '#6FD69C' },
      {
        key: 'task_events_policy',
        value: 'insert only · no update, no delete',
        color: '#6FD69C',
      },
      { key: 'pitr_window', value: '7 days', color: '#E6E6EA' },
      { key: 'migrations_applied', value: '0031 · 4 Aug 2026', color: '#E6E6EA' },
    ],
  },
  {
    k: 'ai',
    title: 'AI providers',
    scope: 'ai_provider_credentials',
    rows: [
      { key: 'primary', value: 'anthropic · claude-sonnet-4-6', color: '#E6E6EA' },
      {
        key: 'primary_key_reference',
        value: 'secret://agentsync/anthropic/key',
        color: '#6A6A73',
      },
      { key: 'fallback', value: 'openai · gpt-5.1', color: '#E6E6EA' },
      {
        key: 'fallback_key_reference',
        value: 'secret://agentsync/openai/key',
        color: '#6A6A73',
      },
      {
        key: 'failover_triggers',
        value: '429, 5xx, timeout · exponential backoff',
        color: '#E6E6EA',
      },
      {
        key: 'failover_requires_optin',
        value: 'true (per project)',
        color: '#6FD69C',
      },
      {
        key: 'tenant_monthly_cap',
        value: '$900 · hard stop at 100%',
        color: '#E6E6EA',
      },
      {
        key: 'data_retention',
        value: 'no training use · prompts redacted before storage',
        color: '#6FD69C',
      },
    ],
  },
];

export const GH_PERMS = [
  { scope: 'contents', level: 'WRITE', c: ['#33240F', '#F0B45E'] as [string, string] },
  {
    scope: 'pull_requests',
    level: 'WRITE',
    c: ['#33240F', '#F0B45E'] as [string, string],
  },
  { scope: 'metadata', level: 'READ', c: OK },
  { scope: 'checks', level: 'READ', c: OK },
  { scope: 'deployments', level: 'READ', c: OK },
  { scope: 'members', level: 'READ', c: OK },
  { scope: 'administration', level: 'NONE', c: OFF },
  { scope: 'secrets / actions', level: 'NONE', c: OFF },
  { scope: 'org_hooks / security', level: 'NONE', c: OFF },
  { scope: 'delete_repository', level: 'NONE', c: OFF },
];

export const HOOKS = [
  {
    dir: 'IN',
    dirFg: '#7FB6E0',
    path: 'POST /api/v1/webhooks/github',
    note: 'PR, push, check_suite · HMAC verified',
    stat: '2,104 · 0 fail',
    statFg: '#6FD69C',
  },
  {
    dir: 'IN',
    dirFg: '#7FB6E0',
    path: 'POST /api/v1/webhooks/vercel',
    note: 'deployment.created / succeeded / error',
    stat: '881 · 0 fail',
    statFg: '#6FD69C',
  },
  {
    dir: 'IN',
    dirFg: '#7FB6E0',
    path: 'POST /api/v1/agent/tasks',
    note: 'task submission · signed + idempotent',
    stat: '38 today',
    statFg: '#9A9AA3',
  },
  {
    dir: 'OUT',
    dirFg: '#F0B45E',
    path: 'https://jira-sync.northwind…/agent-callback',
    note: 'status callbacks · 5 retries, exp. backoff',
    stat: '4 pending',
    statFg: '#F0B45E',
  },
  {
    dir: 'OUT',
    dirFg: '#F0B45E',
    path: 'https://intake.northwind…/agent-callback',
    note: 'status callbacks · signed with HMAC-SHA256',
    stat: '0 pending',
    statFg: '#6FD69C',
  },
  {
    dir: 'OUT',
    dirFg: '#F0B45E',
    path: 'https://legacy-crm.northwind…/hook',
    note: 'disabled with its source system',
    stat: 'off',
    statFg: '#6A6A73',
  },
];

export const SECRETS = [
  {
    ref: 'secret://agentsync/github/app-key',
    used: 'GitHub App',
    rotated: '12 days ago',
    state: 'OK',
    c: OK,
  },
  {
    ref: 'secret://agentsync/github/webhook',
    used: 'GitHub webhook',
    rotated: '12 days ago',
    state: 'OK',
    c: OK,
  },
  {
    ref: 'secret://agentsync/vercel/read-token',
    used: 'Vercel',
    rotated: '31 days ago',
    state: 'OK',
    c: OK,
  },
  {
    ref: 'secret://agentsync/anthropic/key',
    used: 'Anthropic',
    rotated: '8 days ago',
    state: 'OK',
    c: OK,
  },
  {
    ref: 'secret://agentsync/openai/key',
    used: 'OpenAI',
    rotated: '8 days ago',
    state: 'OK',
    c: OK,
  },
  {
    ref: 'secret://northwind/jira-sync/hmac',
    used: 'Callback signing',
    rotated: '94 days ago',
    state: 'ROTATE',
    c: ['#33240F', '#F0B45E'] as [string, string],
  },
  {
    ref: 'secret://northwind/intake/hmac',
    used: 'Callback signing',
    rotated: '22 days ago',
    state: 'OK',
    c: OK,
  },
  {
    ref: 'secret://northwind/legacy-crm/hmac',
    used: 'Disabled source',
    rotated: '210 days ago',
    state: 'REVOKED',
    c: OFF,
  },
];

export const CONN_ALERTS = [
  'secret://northwind/jira-sync/hmac was last rotated 94 days ago — the tenant policy is 90. Rotate it from the source system row.',
  'Reporting is at 92% of its $30 monthly AI cap. Tasks for that project will be refused with AI_BUDGET_EXCEEDED once the cap is reached.',
];

/* ---- tenants -------------------------------------------------------- */

export type TenantUser = {
  name: string;
  email: string;
  role: string;
  active: string;
  state: string;
};

export type Tenant = {
  slug: string;
  name: string;
  plan: string;
  status: 'active' | 'trial';
  meta: string;
  listMeta: string;
  groups: Group[];
  users: TenantUser[];
};

export const ROLE_OPTIONS = [
  'SUPER_ADMIN',
  'TENANT_ADMIN',
  'PROJECT_MANAGER',
  'DEVELOPER',
  'APPROVER',
  'VIEWER',
];

export const TENANTS: Tenant[] = [
  {
    slug: 'northwind',
    name: 'Northwind Group',
    plan: 'SCALE',
    status: 'active',
    meta: '6 projects · 12 users · created 4 Mar 2026',
    listMeta: '6 projects · $248 this month',
    groups: [
      {
        title: 'Details',
        table: 'tenants',
        rows: rows([
          ['name', 'Northwind Group'],
          ['slug', 'northwind'],
          ['status', 'active', '#6FD69C'],
          ['primary_contact', 'andre@northwind.example.com'],
          ['billing_email', 'accounts@northwind.example.com'],
          ['data_region', 'eu-west-1'],
          ['created_at', '2026-03-04'],
          ['notes', 'Pilot tenant · direct support channel'],
        ]),
      },
      {
        title: 'Limits & billing',
        table: 'tenants.settings',
        rows: rows([
          ['plan', 'scale'],
          ['monthly_ai_budget', '$900.00'],
          ['hard_stop_at_cap', 'true', '#6FD69C'],
          ['maximum_projects', '20'],
          ['maximum_concurrent_tasks', '8'],
          ['maximum_source_systems', '10'],
          ['task_retention_days', '400'],
          ['overage_behaviour', 'refuse new tasks', '#F5A623'],
        ]),
      },
      {
        title: 'Policy defaults',
        table: 'tenants.settings.policy',
        rows: rows([
          ['plan_approval_required', 'true', '#6FD69C'],
          ['merge_approval_required', 'true', '#6FD69C'],
          ['production_requires_approval', 'true', '#6FD69C'],
          ['agent_may_merge_own_pr', 'false', '#F08A80'],
          ['fallback_provider_permitted', 'true'],
          ['secret_rotation_days', '90'],
          ['sso_required', 'false'],
          ['ip_allowlist_enforced', 'true', '#6FD69C'],
        ]),
      },
    ],
    users: [
      {
        name: 'Andre B.',
        email: 'andre@leadsync.co.za',
        role: 'SUPER_ADMIN',
        active: '2 minutes ago',
        state: 'ACTIVE',
      },
      {
        name: 'Thandi M.',
        email: 'thandi@northwind.example.com',
        role: 'TENANT_ADMIN',
        active: '1 hour ago',
        state: 'ACTIVE',
      },
      {
        name: 'Pieter R.',
        email: 'pieter@northwind.example.com',
        role: 'APPROVER',
        active: 'Yesterday',
        state: 'ACTIVE',
      },
      {
        name: 'Sarah K.',
        email: 'sarah@northwind.example.com',
        role: 'DEVELOPER',
        active: '3 days ago',
        state: 'ACTIVE',
      },
      {
        name: 'Contractor · J. Nel',
        email: 'jnel@contractor.example.com',
        role: 'VIEWER',
        active: '18 days ago',
        state: 'SUSPENDED',
      },
    ],
  },
  {
    slug: 'meridian-health',
    name: 'Meridian Health',
    plan: 'CORE',
    status: 'active',
    meta: '3 projects · 7 users · created 19 May 2026',
    listMeta: '3 projects · $84 this month',
    groups: [
      {
        title: 'Details',
        table: 'tenants',
        rows: rows([
          ['name', 'Meridian Health'],
          ['slug', 'meridian-health'],
          ['status', 'active', '#6FD69C'],
          ['primary_contact', 'ops@meridian.example.com'],
          ['billing_email', 'finance@meridian.example.com'],
          ['data_region', 'eu-west-1'],
          ['created_at', '2026-05-19'],
          ['notes', 'Health data · stricter retention'],
        ]),
      },
      {
        title: 'Limits & billing',
        table: 'tenants.settings',
        rows: rows([
          ['plan', 'core'],
          ['monthly_ai_budget', '$300.00'],
          ['hard_stop_at_cap', 'true', '#6FD69C'],
          ['maximum_projects', '8'],
          ['maximum_concurrent_tasks', '3'],
          ['maximum_source_systems', '4'],
          ['task_retention_days', '180'],
          ['overage_behaviour', 'refuse new tasks', '#F5A623'],
        ]),
      },
      {
        title: 'Policy defaults',
        table: 'tenants.settings.policy',
        rows: rows([
          ['plan_approval_required', 'true', '#6FD69C'],
          ['merge_approval_required', 'true', '#6FD69C'],
          ['production_requires_approval', 'true', '#6FD69C'],
          ['agent_may_merge_own_pr', 'false', '#F08A80'],
          ['fallback_provider_permitted', 'false', '#F08A80'],
          ['secret_rotation_days', '60'],
          ['sso_required', 'true', '#6FD69C'],
          ['ip_allowlist_enforced', 'true', '#6FD69C'],
        ]),
      },
    ],
    users: [
      {
        name: 'Nomsa D.',
        email: 'nomsa@meridian.example.com',
        role: 'TENANT_ADMIN',
        active: '4 hours ago',
        state: 'ACTIVE',
      },
      {
        name: 'Dr J. Kruger',
        email: 'jkruger@meridian.example.com',
        role: 'APPROVER',
        active: '2 days ago',
        state: 'ACTIVE',
      },
      {
        name: 'Ops rota',
        email: 'ops@meridian.example.com',
        role: 'VIEWER',
        active: '6 hours ago',
        state: 'ACTIVE',
      },
    ],
  },
  {
    slug: 'cape-logistics',
    name: 'Cape Logistics',
    plan: 'TRIAL',
    status: 'trial',
    meta: '2 projects · 4 users · created 28 Jul 2026',
    listMeta: '2 projects · trial ends 27 Aug',
    groups: [
      {
        title: 'Details',
        table: 'tenants',
        rows: rows([
          ['name', 'Cape Logistics'],
          ['slug', 'cape-logistics'],
          ['status', 'trial', '#F5A623'],
          ['primary_contact', 'dev@capelogistics.example.com'],
          ['billing_email', '—'],
          ['data_region', 'eu-west-1'],
          ['created_at', '2026-07-28'],
          ['notes', 'Trial · sandbox repositories only'],
        ]),
      },
      {
        title: 'Limits & billing',
        table: 'tenants.settings',
        rows: rows([
          ['plan', 'trial'],
          ['monthly_ai_budget', '$50.00'],
          ['hard_stop_at_cap', 'true', '#6FD69C'],
          ['maximum_projects', '2'],
          ['maximum_concurrent_tasks', '1'],
          ['maximum_source_systems', '1'],
          ['task_retention_days', '30'],
          ['trial_ends_at', '2026-08-27', '#F5A623'],
        ]),
      },
      {
        title: 'Policy defaults',
        table: 'tenants.settings.policy',
        rows: rows([
          ['plan_approval_required', 'true', '#6FD69C'],
          ['merge_approval_required', 'true', '#6FD69C'],
          ['production_requires_approval', 'true', '#6FD69C'],
          ['agent_may_merge_own_pr', 'false', '#F08A80'],
          ['fallback_provider_permitted', 'false', '#F08A80'],
          ['secret_rotation_days', '90'],
          ['sso_required', 'false'],
          ['ip_allowlist_enforced', 'false', '#F5A623'],
        ]),
      },
    ],
    users: [
      {
        name: 'Riaan V.',
        email: 'riaan@capelogistics.example.com',
        role: 'TENANT_ADMIN',
        active: '1 day ago',
        state: 'ACTIVE',
      },
      {
        name: 'Lebo S.',
        email: 'lebo@capelogistics.example.com',
        role: 'DEVELOPER',
        active: '1 day ago',
        state: 'ACTIVE',
      },
    ],
  },
  {
    slug: 'agentsync-internal',
    name: 'Internal · AgentSync',
    plan: 'INTERNAL',
    status: 'active',
    meta: '1 project · 3 users · created 12 Feb 2026',
    listMeta: '1 project · dogfooding',
    groups: [
      {
        title: 'Details',
        table: 'tenants',
        rows: rows([
          ['name', 'Internal · AgentSync'],
          ['slug', 'agentsync-internal'],
          ['status', 'active', '#6FD69C'],
          ['primary_contact', 'andre@leadsync.co.za'],
          ['billing_email', '—'],
          ['data_region', 'eu-west-1'],
          ['created_at', '2026-02-12'],
          ['notes', 'The platform improving itself'],
        ]),
      },
      {
        title: 'Limits & billing',
        table: 'tenants.settings',
        rows: rows([
          ['plan', 'internal'],
          ['monthly_ai_budget', '$400.00'],
          ['hard_stop_at_cap', 'false', '#F5A623'],
          ['maximum_projects', 'unlimited'],
          ['maximum_concurrent_tasks', '4'],
          ['maximum_source_systems', '3'],
          ['task_retention_days', '400'],
          ['overage_behaviour', 'warn only', '#F5A623'],
        ]),
      },
      {
        title: 'Policy defaults',
        table: 'tenants.settings.policy',
        rows: rows([
          ['plan_approval_required', 'false', '#F5A623'],
          ['merge_approval_required', 'true', '#6FD69C'],
          ['production_requires_approval', 'true', '#6FD69C'],
          ['agent_may_merge_own_pr', 'false', '#F08A80'],
          ['fallback_provider_permitted', 'true'],
          ['secret_rotation_days', '90'],
          ['sso_required', 'true', '#6FD69C'],
          ['ip_allowlist_enforced', 'false'],
        ]),
      },
    ],
    users: [
      {
        name: 'Andre B.',
        email: 'andre@leadsync.co.za',
        role: 'SUPER_ADMIN',
        active: '2 minutes ago',
        state: 'ACTIVE',
      },
      {
        name: 'Platform worker',
        email: 'agentsync[bot]',
        role: 'DEVELOPER',
        active: 'now',
        state: 'SERVICE',
      },
    ],
  },
];

export const DANGER_ACTIONS = [
  {
    title: 'Suspend tenant',
    text: 'Queued tasks stop, the submission API returns PROJECT_DISABLED, and no worker picks up new work. Configuration and history are preserved.',
    action: 'Suspend',
  },
  {
    title: 'Revoke all API keys',
    text: 'Every source system for this tenant stops being accepted immediately. New keys must be issued and distributed by hand.',
    action: 'Revoke keys',
  },
  {
    title: 'Disconnect integrations',
    text: 'Removes the GitHub App installation and Vercel link for every project under this tenant. Repositories are untouched.',
    action: 'Disconnect',
  },
  {
    title: 'Delete tenant',
    text: 'Permanently removes projects, tasks, plans and approvals. The append-only audit log is retained for the configured period and cannot be deleted here.',
    action: 'Delete',
  },
];
