import 'server-only';
import { resolveSecret } from './secrets';
import { querySql, runSql } from './supabase-mgmt';
import { serviceClient } from './supabase';

/**
 * A linked Supabase database, as the agents see it: its shape (read from the
 * catalog, never its data) for the Planner and the Engineer, and a way to try
 * a change's SQL without keeping it. The access token stays here; only the
 * schema text reaches a sandbox.
 */

export type TaskDatabase = { token: string; ref: string; projectName: string | null };

/**
 * The database a task's project is linked to, with the tenant's token — or
 * null when Supabase isn't connected or the project isn't linked.
 */
export async function taskDatabase(taskId: string): Promise<TaskDatabase | null> {
  const { data } = await serviceClient().rpc('agentsync_task_database', { p_task_id: taskId });
  const cfg = (data ?? {}) as { token_reference?: string | null; supabase_project_ref?: string | null; project_name?: string | null };
  if (!cfg.token_reference || !cfg.supabase_project_ref) return null;
  return { token: await resolveSecret(cfg.token_reference), ref: cfg.supabase_project_ref, projectName: cfg.project_name ?? null };
}

// The project's own schemas only: Supabase's (auth, storage, …) and anything
// an extension owns are left out. Catalog lookups, nothing else.
const SCHEMA_SQL = String.raw`
with ns as (
  select n.oid, n.nspname from pg_namespace n
   where n.nspname not like 'pg\_%' and n.nspname not like '\_%'
     and n.nspname not in ('information_schema', 'auth', 'storage', 'realtime', 'supabase_functions', 'supabase_migrations',
       'extensions', 'graphql', 'graphql_public', 'net', 'pgsodium', 'pgsodium_masks', 'vault', 'pgbouncer', 'cron',
       'pgmq', 'pgtle', 'tiger', 'tiger_data', 'topology')
), ext as (
  select objid from pg_depend where deptype = 'e'
)
select json_build_object(
  'tables', (select json_agg(json_build_object(
      'name', ns.nspname || '.' || c.relname,
      'kind', case c.relkind when 'v' then 'view' when 'm' then 'materialized view' else 'table' end,
      'rls', c.relrowsecurity,
      'columns', (select json_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
                    || case when a.attnotnull then ' not null' else '' end
                    || coalesce(' default ' || left(pg_get_expr(d.adbin, d.adrelid), 60), '') order by a.attnum)
                    from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
                   where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped),
      'constraints', (select json_agg(x.conname || ': ' || pg_get_constraintdef(x.oid) order by x.contype, x.conname)
                        from pg_constraint x where x.conrelid = c.oid and x.contype in ('p', 'f', 'u', 'c')),
      'indexes', (select json_agg(pg_get_indexdef(i.indexrelid)) from pg_index i where i.indrelid = c.oid and not i.indisprimary),
      'policies', (select json_agg(p.polname || ' (' || case p.polcmd when 'r' then 'select' when 'a' then 'insert' when 'w' then 'update' when 'd' then 'delete' else 'all' end || ')')
                     from pg_policy p where p.polrelid = c.oid),
      'triggers', (select json_agg(t.tgname) from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal)
    ) order by ns.nspname, c.relname)
    from pg_class c join ns on ns.oid = c.relnamespace
   where c.relkind in ('r', 'p', 'v', 'm') and c.oid not in (select objid from ext)),
  'enums', (select json_agg(ns.nspname || '.' || t.typname || ': ' || (select string_agg(e.enumlabel, ', ' order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid) order by 1)
              from pg_type t join ns on ns.oid = t.typnamespace where t.typtype = 'e' and t.oid not in (select objid from ext)),
  'functions', (select json_agg(ns.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') → ' || pg_get_function_result(p.oid) order by 1)
                  from pg_proc p join ns on ns.oid = p.pronamespace where p.prokind in ('f', 'p') and p.oid not in (select objid from ext))
) as schema
`;

type SchemaTable = {
  name: string;
  kind: string;
  rls: boolean;
  columns: string[] | null;
  constraints: string[] | null;
  indexes: string[] | null;
  policies: string[] | null;
  triggers: string[] | null;
};
export type DatabaseSchema = { tables: SchemaTable[]; enums: string[]; functions: string[] };

export async function readSchema(token: string, ref: string): Promise<DatabaseSchema> {
  const [row] = await querySql<{ schema: Partial<DatabaseSchema> | null }>(token, ref, SCHEMA_SQL);
  const s = row?.schema ?? {};
  return { tables: s.tables ?? [], enums: s.enums ?? [], functions: s.functions ?? [] };
}

/** The whole schema as markdown, for the sandbox (capped). */
export function schemaMarkdown(s: DatabaseSchema, projectName: string, cap = 200_000): string {
  const out = [
    `# Database schema: ${projectName}`,
    '',
    'Read from the live database when this build started. Supabase\'s own schemas (auth, storage, …) are left out.',
    '',
  ];
  for (const t of s.tables) {
    out.push(`## ${t.name}${t.kind === 'table' ? '' : ` (${t.kind})`}${t.rls ? ' · RLS on' : ''}`);
    for (const c of t.columns ?? []) out.push(`- ${c}`);
    for (const c of t.constraints ?? []) out.push(`- constraint ${c}`);
    for (const i of t.indexes ?? []) out.push(`- ${i}`);
    for (const p of t.policies ?? []) out.push(`- policy ${p}`);
    if (t.triggers?.length) out.push(`- triggers: ${t.triggers.join(', ')}`);
    out.push('');
  }
  if (s.enums.length) out.push('## Enum types', ...s.enums.map((e) => `- ${e}`), '');
  if (s.functions.length) out.push('## Functions', ...s.functions.map((f) => `- ${f}`), '');
  const text = out.join('\n');
  return text.length > cap ? `${text.slice(0, cap)}\n\n(cut at ${cap} characters)\n` : text;
}

/** Just the tables and their column names, for the Planner's prompt. */
export function schemaSummary(s: DatabaseSchema, cap = 20_000): string {
  const text = s.tables
    .map((t) => `${t.name}${t.kind === 'table' ? '' : ` (${t.kind})`}: ${(t.columns ?? []).map((c) => c.split(' ')[0]).join(', ')}`)
    .join('\n');
  return text.length > cap ? `${text.slice(0, cap)}\n…` : text;
}

/* ---- trying a change's SQL without keeping it -------------------------- */

/** SQL with function bodies, comments and strings blanked, to look at its statements. */
function statementsOnly(sql: string): string {
  return sql
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)?\$[\s\S]*?\$\1\$/g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''");
}

/**
 * Why this SQL can't be tried in a transaction that is then rolled back, or
 * null when it can: it manages its own transactions, or uses statements
 * Postgres refuses inside one.
 */
export function cannotDryRun(sql: string): string | null {
  const s = statementsOnly(sql);
  if (/(^|;)\s*(begin|commit|end|rollback|abort|start\s+transaction|savepoint|release|prepare\s+transaction)\b/i.test(s)) {
    return 'it manages its own transaction (BEGIN/COMMIT)';
  }
  if (/\bconcurrently\b/i.test(s)) return 'it uses CONCURRENTLY, which cannot run inside a transaction';
  if (/(^|;)\s*(vacuum|create\s+database|drop\s+database|alter\s+system|create\s+tablespace|drop\s+tablespace)\b/i.test(s)) {
    return 'it uses a statement that cannot run inside a transaction';
  }
  return null;
}

export type DryRun = { status: 'passed' } | { status: 'failed'; error: string } | { status: 'skipped'; reason: string };

const DRY_RUN_OK = 'AGENTSYNC_DRY_RUN_OK';

/**
 * Tries the SQL on the database as it is now and keeps nothing: it runs
 * inside one DO block that always ends by raising, so Postgres rolls all of
 * it back, and no transaction is left open on the connection. A short lock
 * timeout, so a test never waits on a busy live table.
 */
export async function dryRunSql(token: string, ref: string, sql: string): Promise<DryRun> {
  const why = cannotDryRun(sql);
  if (why) return { status: 'skipped', reason: `not tested: ${why}` };
  const tag = `$agentsync_sql_${Math.random().toString(36).slice(2, 10)}$`;
  if (sql.includes(tag)) return { status: 'skipped', reason: 'not tested: the script could not be wrapped' };
  const res = await runSql(token, ref, [
    'do $agentsync_dry_run$ begin',
    "  perform set_config('lock_timeout', '5s', true);",
    `  execute ${tag}${sql}${tag};`,
    `  raise exception '${DRY_RUN_OK}';`,
    'end $agentsync_dry_run$;',
  ].join('\n'));
  if (res.ok) return { status: 'failed', error: 'the test did not roll back as expected' };
  if (res.error.includes(DRY_RUN_OK)) return { status: 'passed' };
  return { status: 'failed', error: res.error.replace(/\nCONTEXT:[\s\S]*$/, '').replace(/^\d+: /, '') };
}
