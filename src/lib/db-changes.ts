import 'server-only';
import { readTaskBranchFile } from './stages';
import { runSql } from './supabase-mgmt';
import { taskDatabase } from './supabase-schema';
import { serviceClient } from './supabase';

/**
 * Running a change's database scripts on the project's linked Supabase
 * database, on a person's behalf: from its own button, or as the first step
 * of approving the merge. The SQL is read from the task's branch as it is
 * now, so what runs is what is about to be merged. Callers check the person
 * may approve the task's work first.
 */

export type DbChange = {
  id: string;
  path: string;
  status: 'pending' | 'applied' | 'marked_applied' | 'failed';
  dry_run_status: 'passed' | 'failed' | 'skipped' | null;
};

export class DbChangeError extends Error {
  constructor(public code: string, message: string, public status = 422) {
    super(message);
  }
}

export async function dbChangesFor(taskId: string): Promise<DbChange[]> {
  const { data } = await serviceClient().rpc('agentsync_db_changes_for', { p_task_id: taskId });
  return (data ?? []) as DbChange[];
}

async function mark(userId: string, changeId: string, status: 'applied' | 'marked_applied' | 'failed', output: string | null) {
  const { data, error } = await serviceClient().rpc('agentsync_db_change_mark', {
    p_user_id: userId,
    p_change_id: changeId,
    p_status: status,
    p_output: output,
  });
  if (error || !(data as { ok?: boolean } | null)?.ok) throw new DbChangeError('INTERNAL_ERROR', 'could not record the result', 500);
}

export async function markDbChangeApplied(userId: string, change: DbChange) {
  await mark(userId, change.id, 'marked_applied', null);
}

/** Runs one script; throws DbChangeError (and records the failure) when it can't. */
export async function applyDbChange(taskId: string, userId: string, change: DbChange): Promise<void> {
  let target;
  try {
    target = await taskDatabase(taskId);
  } catch (e) {
    throw new DbChangeError('SECRET_UNAVAILABLE', (e as Error).message);
  }
  if (!target) throw new DbChangeError('NOT_CONNECTED', 'Supabase is not connected, or this project is not linked to a database.', 409);
  const sql = await readTaskBranchFile(taskId, change.path);
  if (!sql?.trim()) throw new DbChangeError('SCRIPT_NOT_FOUND', `${change.path} is not on the branch`, 404);

  const result = await runSql(target.token, target.ref, sql);
  if (!result.ok) {
    await mark(userId, change.id, 'failed', result.error);
    throw new DbChangeError('RUN_FAILED', `${change.path}: ${result.error}`);
  }
  await mark(userId, change.id, 'applied', `Ran on ${target.ref}: ${result.result}`);
}

/**
 * Every script not yet applied, in path order (migrations are numbered).
 * Stops at the first failure: nothing after it runs, and the merge waits.
 */
export async function applyPendingDbChanges(taskId: string, userId: string): Promise<number> {
  const pending = (await dbChangesFor(taskId)).filter((c) => c.status === 'pending' || c.status === 'failed');
  for (const c of pending) await applyDbChange(taskId, userId, c);
  return pending.length;
}
