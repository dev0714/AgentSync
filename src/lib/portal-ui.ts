/**
 * Presentation for the control plane: the colour vocabulary, the status maps
 * and the formatters every screen shares.
 *
 * Nothing here is data. It never invents a row, a count or a name — it only
 * decides how a value that came from the database is drawn.
 */

export const ACCENT = 'var(--color-accent)';
export const GATE = 'var(--color-gate)';

export type Swatch = [background: string, foreground: string];

/*
 * Light tints with dark text, every pair at 4.5:1 or better.
 *
 * GATE is reserved for "a person has to decide" — approval gates and the
 * questions an agent is waiting on. CAUTION covers everything else worth a
 * second look (a suspended account, a repaired check) so that orange keeps
 * meaning one thing across the whole control plane.
 */
export const OK: Swatch = ['var(--color-ok-tint)', 'var(--color-ok-ink)'];
export const GATE_SWATCH: Swatch = ['var(--color-gate-tint)', 'var(--color-gate-ink)'];
export const CAUTION: Swatch = ['var(--color-caution-tint)', 'var(--color-caution-ink)'];
export const WARN = CAUTION;
export const OFF: Swatch = ['var(--color-line-faint)', 'var(--color-ink-3)'];
export const NO: Swatch = ['var(--color-danger-tint)', 'var(--color-danger-ink)'];
export const INFO: Swatch = ['var(--color-agent-tint)', 'var(--color-agent-ink)'];

export type Row = { key: string; value: string; color?: string };
export type Line = { text: string; color: string };

/** Every task status, in the order the pipeline reaches them. */
export const TASK_STATUS_COLOUR: Record<string, Swatch> = {
  received: OFF,
  validating: OFF,
  queued: OFF,
  analysing: INFO,
  planning: INFO,
  awaiting_plan_approval: GATE_SWATCH,
  implementing: INFO,
  testing: INFO,
  creating_pull_request: INFO,
  deploying_preview: INFO,
  awaiting_merge_approval: GATE_SWATCH,
  deploying_production: INFO,
  awaiting_production_approval: GATE_SWATCH,
  needs_information: GATE_SWATCH,
  completed: OK,
  failed: NO,
  cancelled: OFF,
  rolled_back: NO,
};

export const DEPLOYMENT_STATUS_COLOUR: Record<string, Swatch> = {
  QUEUED: OFF,
  BUILDING: INFO,
  READY: OK,
  ERROR: NO,
  CANCELLED: OFF,
  AWAITING_APPROVAL: GATE_SWATCH,
};

export const ENVIRONMENT_COLOUR: Record<string, Swatch> = {
  preview: INFO,
  production: OK,
  rollback: WARN,
};

export const GATE_COLOUR: Record<string, Swatch> = {
  plan: GATE_SWATCH,
  merge: GATE_SWATCH,
  production: GATE_SWATCH,
  information: GATE_SWATCH,
};

export const GRANT_COLOUR: Record<string, Swatch> = {
  ALLOW: OK,
  LIMITED: WARN,
  DENY: OFF,
};

export const STATE_COLOUR: Record<string, Swatch> = {
  ACTIVE: OK,
  TEST: INFO,
  SERVICE: INFO,
  DISABLED: OFF,
  SUSPENDED: WARN,
  INVITED: WARN,
};

export const SEVERITY_COLOUR: Record<string, Swatch> = {
  low: OFF,
  medium: WARN,
  high: NO,
};

export const RESULT_COLOUR: Record<string, Swatch> = {
  PASSED: OK,
  REPAIRED: WARN,
  FAILED: NO,
  SKIPPED: OFF,
};

export const VERDICT_COLOUR: Record<string, Swatch> = {
  submit: OK,
  changes: WARN,
  reject: NO,
};

/**
 * A status as a person would say it: `awaiting_merge_approval` reads
 * "Awaiting merge approval". The raw value stays available wherever it is
 * the thing being searched for or copied.
 */
export function statusLabel(status: string | null | undefined): string {
  if (!status) return '—';
  const words = status.toLowerCase().replace(/[._]/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** True for any status that is waiting on a person. */
export function isGate(status: string | null | undefined): boolean {
  return !!status && (status.startsWith('awaiting_') || status === 'needs_information');
}

export function swatch(map: Record<string, Swatch>, key: string | null): Swatch {
  return (key && map[key]) || OFF;
}

/** Audit event types are open-ended, so colour by prefix rather than by list. */
export function eventColour(type: string): string {
  if (type.startsWith('security') || type.includes('denied') || type.includes('failed')) {
    return 'var(--color-danger-ink)';
  }
  if (type.includes('approval') || type.includes('awaiting')) return 'var(--color-gate-ink)';
  if (type.includes('completed') || type.includes('approved')) return 'var(--color-ok-ink)';
  if (type.startsWith('task.')) return 'var(--color-agent-ink)';
  return 'var(--color-muted-2)';
}

/* ---- task list filters ---------------------------------------------- */

export type FilterKey = 'all' | 'gate' | 'running' | 'failed' | 'completed';

export const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'gate', label: 'Needs a decision' },
  { key: 'running', label: 'In progress' },
  { key: 'failed', label: 'Failed' },
  { key: 'completed', label: 'Completed' },
];

const IN_FLIGHT = new Set([
  'received',
  'validating',
  'queued',
  'analysing',
  'planning',
  'implementing',
  'testing',
  'creating_pull_request',
  'deploying_preview',
  'deploying_production',
]);

export function matchesFilter(status: string, filter: FilterKey): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'gate':
      return status.startsWith('awaiting') || status === 'needs_information';
    case 'running':
      return IN_FLIGHT.has(status);
    case 'failed':
      return status === 'failed' || status === 'rolled_back';
    case 'completed':
      return status === 'completed';
  }
}

/* ---- formatting ------------------------------------------------------ */

/**
 * How long ago, in the shortest form that is still unambiguous. Rendered on the
 * client only — computing it on the server would bake the server's clock into
 * static output and then disagree with the browser on hydration.
 */
export function ago(iso: string | null): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d`;
  return new Date(iso).toISOString().slice(0, 10);
}

/** 24-hour clock, UTC, so two people reading the same log agree on the time. */
export function clock(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toISOString().slice(11, 19);
}

export function money(value: number | null | undefined): string {
  if (value === null || value === undefined) return '$0.00';
  return `$${Number(value).toFixed(2)}`;
}

export function compact(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function duration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  const s = Number(seconds);
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

/** Progress the pipeline has actually reported, never a guess from the status. */
export function percent(value: number | null | undefined): string {
  return `${Math.max(0, Math.min(100, Math.round(Number(value ?? 0))))}%`;
}

/* ---- turning a record into configuration rows ------------------------ */

function display(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

const HIDDEN = new Set([
  'id',
  'tenant_id',
  'project_id',
  'agent_definition_id',
  'created_at',
  'updated_at',
]);

/**
 * Configuration rows straight from a database record, in column order, with
 * the bookkeeping columns dropped. A missing record yields no rows at all —
 * the screen then says the configuration has not been created, rather than
 * showing a form full of invented defaults.
 */
export function rowsFrom(
  record: Record<string, unknown> | null | undefined,
  omit: string[] = [],
): Row[] {
  if (!record) return [];
  const skip = new Set([...HIDDEN, ...omit]);
  return Object.entries(record)
    .filter(([key]) => !skip.has(key))
    .map(([key, value]) => ({
      key,
      value: display(value),
      color: typeof value === 'boolean' ? (value ? 'var(--color-ok-ink)' : 'var(--color-muted-2)') : undefined,
    }));
}
