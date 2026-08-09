/**
 * Presentation for the control plane: the colour vocabulary, the status maps
 * and the formatters every screen shares.
 *
 * Nothing here is data. It never invents a row, a count or a name — it only
 * decides how a value that came from the database is drawn.
 */

export const ACCENT = '#7C9CF5';

export type Swatch = [background: string, foreground: string];

export const OK: Swatch = ['#122E1E', '#6FD69C'];
export const WARN: Swatch = ['#33240F', '#F5A623'];
export const OFF: Swatch = ['#212125', '#9A9AA3'];
export const NO: Swatch = ['#331515', '#F08A80'];
export const INFO: Swatch = ['#132430', '#7FB6E0'];

export type Row = { key: string; value: string; color?: string };
export type Line = { text: string; color: string };

/** Every task status, in the order the pipeline reaches them. */
export const TASK_STATUS_COLOUR: Record<string, Swatch> = {
  received: OFF,
  validating: OFF,
  queued: OFF,
  analysing: INFO,
  planning: INFO,
  awaiting_plan_approval: WARN,
  implementing: INFO,
  testing: INFO,
  creating_pull_request: INFO,
  deploying_preview: INFO,
  awaiting_merge_approval: WARN,
  deploying_production: INFO,
  awaiting_production_approval: WARN,
  needs_information: WARN,
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
  AWAITING_APPROVAL: WARN,
};

export const ENVIRONMENT_COLOUR: Record<string, Swatch> = {
  preview: INFO,
  production: OK,
  rollback: WARN,
};

export const GATE_COLOUR: Record<string, Swatch> = {
  plan: INFO,
  merge: WARN,
  production: NO,
  information: OFF,
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

export function swatch(map: Record<string, Swatch>, key: string | null): Swatch {
  return (key && map[key]) || OFF;
}

/** Audit event types are open-ended, so colour by prefix rather than by list. */
export function eventColour(type: string): string {
  if (type.startsWith('security') || type.includes('denied') || type.includes('failed')) {
    return '#F08A80';
  }
  if (type.includes('approval') || type.includes('awaiting')) return '#F5A623';
  if (type.includes('completed') || type.includes('approved')) return '#6FD69C';
  if (type.startsWith('task.')) return '#7FB6E0';
  return '#9A9AA3';
}

/* ---- task list filters ---------------------------------------------- */

export type FilterKey = 'all' | 'gate' | 'running' | 'failed' | 'completed';

export const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'gate', label: 'Awaiting a human' },
  { key: 'running', label: 'In flight' },
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
      color: typeof value === 'boolean' ? (value ? '#6FD69C' : '#9A9AA3') : undefined,
    }));
}
