/**
 * Copy for the public AgentSync site. Layout lives in src/app/page.tsx and
 * src/components/site/; everything a reader reads lives here, so copy changes
 * never touch layout.
 *
 * Every claim below describes behaviour the platform has or is specified to
 * have. Nothing here is a statistic.
 */

export const nav = [
  { href: '#how', label: 'How it works' },
  { href: '#guardrails', label: 'Guardrails' },
  { href: '#integrations', label: 'Integrations' },
  { href: '#types', label: 'What to send it' },
];

/** The hero pipeline. The sixth station is the human gate. */
export type StationIcon = 'inbox' | 'plan' | 'code' | 'check' | 'eye' | 'person' | 'ship';

export const stations: {
  name: string;
  text: string;
  icon: StationIcon;
  kind: 'done' | 'gate' | 'next';
}[] = [
  { name: 'Request', text: 'Sent from any system that can sign a call', icon: 'inbox', kind: 'done' },
  { name: 'Plan', text: 'Reads the repository first, then writes a plan', icon: 'plan', kind: 'done' },
  { name: 'Build', text: 'Changes the code on an isolated branch', icon: 'code', kind: 'done' },
  { name: 'Check', text: 'Runs your lint, types, tests and build', icon: 'check', kind: 'done' },
  { name: 'Review', text: 'Checks the diff against every criterion', icon: 'eye', kind: 'done' },
  { name: 'You decide', text: 'Approve, ask for changes, or reject', icon: 'person', kind: 'gate' },
  { name: 'Ship', text: 'Merges and deploys only after that', icon: 'ship', kind: 'next' },
];

/** Where work comes from — the marquee under the hero. */
export const sources = [
  'Your service desk',
  'An intake portal',
  'Your CRM',
  'An internal tool',
  'A cron job',
  'Another agent',
];

export const agents = [
  { name: 'Orchestrator', out: 'STATE' },
  { name: 'Planner', out: 'PLAN' },
  { name: 'Coder', out: 'DIFF' },
  { name: 'Reviewer', out: 'VERDICT' },
  { name: 'Validator', out: 'CHECKS' },
];

export const gates = [
  { label: 'Approve the plan', on: true },
  { label: 'Approve the merge', on: true },
  { label: 'Approve production', on: true },
];

export const evidence = [
  'The plan it followed, and every assumption it made',
  'Every command it ran, with the real exit code',
  'A review verdict against each acceptance criterion',
];

export const checks = ['lint', 'typecheck', 'tests · 1 repair', 'build'];

export const denies = [
  'Merge its own pull request without a recorded human approval',
  'Deploy to production ahead of the configured approval',
  'Push straight to a production branch, unless a project allows it',
  'Touch a protected path, or exceed its file and line limits',
  'Read a secret, or write one into a log, commit or pull request',
  'Delete a repository or switch off branch protection',
  'Change security or CI configuration outside an approved scope',
  'Reach a repository or tenant it was not configured for',
];

export const controls = [
  {
    title: 'Tenant isolation',
    text: 'Row-level security on every tenant table. Privileged access lives only in server-side workers, never in a browser.',
  },
  {
    title: 'Least-privilege GitHub',
    text: 'A GitHub App, not personal tokens. Access is minted per task and expires in under an hour.',
  },
  {
    title: 'Sandboxed execution',
    text: 'Only your allowlisted commands run. No network during execution, and the workspace is destroyed after.',
  },
  {
    title: 'Budgets that stop',
    text: 'Token, cost and time ceilings per project. A retry never opens a second branch, pull request or deploy.',
  },
];

export const integrations: {
  name: string;
  text: string;
  status: string;
  tone: 'ok' | 'gate' | 'agent';
}[] = [
  {
    name: 'GitHub',
    text: 'App-based access, isolated branches, and pull requests with the full task record attached.',
    status: 'Supported',
    tone: 'ok',
  },
  {
    name: 'Vercel',
    text: 'Deployments stay owned by your Git integration. AgentSync listens and records.',
    status: 'Supported',
    tone: 'ok',
  },
  {
    name: 'Supabase',
    text: 'Configuration, tasks, approvals and an append-only event log, isolated per tenant.',
    status: 'Supported',
    tone: 'ok',
  },
  {
    name: 'Claude',
    text: 'Planning, implementation and review.',
    status: 'Primary model',
    tone: 'ok',
  },
  {
    name: 'OpenAI',
    text: 'Used on a temporary failure, and only where the project has opted in.',
    status: 'Fallback, opt-in',
    tone: 'gate',
  },
  {
    name: 'Your systems',
    text: 'Service desk, intake portal, CRM, internal tool, cron job, or another agent.',
    status: 'Any signed call',
    tone: 'agent',
  },
];

export const requestTypes = [
  { type: 'code_change', text: 'Features, fixes and small enhancements against an existing codebase.' },
  { type: 'refactor', text: 'Structural work with no behaviour change, held to the same test bar.' },
  { type: 'dependency_update', text: 'Version bumps, lockfile maintenance, deprecation clean-ups.' },
  { type: 'migration', text: 'Schema and data migrations, gated harder than ordinary changes.' },
  { type: 'investigation', text: 'Read-only analysis that returns findings and opens nothing.' },
  { type: 'custom', text: 'Your own type, with its own prompt, limits and approval policy.' },
];
