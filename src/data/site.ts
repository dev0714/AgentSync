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
  { href: '#maps', label: 'Code maps' },
  { href: '#guardrails', label: 'Guardrails' },
  { href: '#integrations', label: 'Integrations' },
  { href: '#types', label: 'What to send it' },
];

/**
 * The hero pipeline, in the order a request moves through it. The two
 * "You decide" stations are the human gates; `ms` is how long the animation
 * dwells on each, so the pause for a person is visibly longer.
 */
export type StationIcon = 'inbox' | 'map' | 'plan' | 'code' | 'eye' | 'person' | 'ship';

export const stations: {
  name: string;
  text: string;
  icon: StationIcon;
  kind: 'agent' | 'gate' | 'ship';
  isNew?: boolean;
  ms: number;
}[] = [
  { name: 'Request', text: 'Sent from any system that can sign a call', icon: 'inbox', kind: 'agent', ms: 1200 },
  { name: 'Map', text: 'Finds the code the request is about', icon: 'map', kind: 'agent', isNew: true, ms: 1200 },
  { name: 'Plan', text: 'Lists every file, and what the change affects', icon: 'plan', kind: 'agent', ms: 1200 },
  { name: 'You decide', text: 'Approve the plan before anything is built', icon: 'person', kind: 'gate', ms: 2400 },
  { name: 'Build', text: 'Changes the code on an isolated branch', icon: 'code', kind: 'agent', ms: 1400 },
  { name: 'Check & review', text: 'Your checks, then the callers the map lists', icon: 'eye', kind: 'agent', ms: 1300 },
  { name: 'You decide', text: 'Approve, ask for changes, or reject', icon: 'person', kind: 'gate', ms: 2400 },
  { name: 'Ship', text: 'Merges, tags a release, writes the changelog', icon: 'ship', kind: 'ship', isNew: true, ms: 2800 },
];

/** What's new, for the announcement line in the hero. */
export const whatsNew = ['Code maps', 'One-click service desk connection', 'Releases and changelogs', 'Light and dark control plane'];

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

export const evidence: { text: string; isNew?: boolean }[] = [
  { text: 'The plan it followed, and every assumption it made' },
  { text: 'What the change affects, from the code map', isNew: true },
  { text: 'Every command it ran, with the real exit code' },
  { text: 'A review verdict against each acceptance criterion' },
  { text: 'A release version and a changelog entry', isNew: true },
];

/** The code maps section. */
export const mapFeatures = [
  {
    title: 'Maps every project',
    text: 'Graphify reads the repository and groups it into named parts — Invoices, Tickets, Auth — refreshed as changes merge.',
  },
  {
    title: 'Finds the code a request is about',
    text: 'Before planning, the agent searches the map for the functions and files the request touches, and routes it to the right repository.',
  },
  {
    title: 'Shows what a change affects',
    text: 'Every plan lists the callers the change reaches. Hubs — code much of the system depends on — are flagged before you approve.',
  },
  {
    title: 'Learns from every task',
    text: 'Useful hits, dead ends and your corrections are written back to the map, so the next request starts better informed.',
  },
];

export const impact = [
  { name: 'calculateTotals', where: 'invoices/totals.ts', tag: 'The change', tone: 'agent' },
  { name: 'BillingService.fromTicket', where: 'invoices/billing.ts', tag: 'Hub', tone: 'gate' },
  { name: 'TicketController.close', where: 'tickets/controller.ts', tag: 'Caller', tone: 'plain' },
  { name: 'InvoiceMailer.send', where: 'email/invoice.ts', tag: 'Caller', tone: 'plain' },
  { name: 'onMerge', where: 'hooks/merge.ts', tag: 'Caller', tone: 'plain' },
] as const;

/** The service desk section. */
export const deskPoints = [
  'Connect a service desk to a tenant in one click — no keys to copy',
  'Map clients to repositories, or let AgentSync choose from the code maps',
  'Internal notes on the ticket as the work moves',
  'A plain-language note for the client when the change ships',
];

/** The control plane section. */
export const portalRows = [
  { id: 'TICKET-1045', title: 'Add a status filter to the dashboard', state: 'Plan approval', tone: 'gate' },
  { id: 'TICKET-1042', title: 'Export customers to CSV', state: 'Merge approval', tone: 'gate' },
  { id: 'TICKET-1039', title: 'Stop duplicate reminder emails', state: 'Agent working', tone: 'agent' },
  { id: 'TICKET-1031', title: 'Invoices show VAT on its own line', state: 'Shipped · v2.14.0', tone: 'ok' },
] as const;


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
    name: 'Graphify',
    text: 'Code maps for every project: named parts, callers, impact and lessons learned.',
    status: 'New',
    tone: 'agent',
  },
  {
    name: 'Service desks',
    text: 'One-click connection per tenant, with notes back on the ticket and a note for the client.',
    status: 'New',
    tone: 'agent',
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
