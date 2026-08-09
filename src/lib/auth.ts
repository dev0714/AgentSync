import 'server-only';
import { serviceClient } from './supabase';

/**
 * Identity for AgentSync, backed by agentsync.users rather than Supabase Auth.
 *
 * Password hashing and comparison happen inside PostgreSQL (bcrypt, via
 * agentsync.set_password / agentsync.verify_password), so plaintext never
 * reaches application logs and the hash never leaves the database. The helper
 * functions are granted to the service role only, which is why every call here
 * goes through serviceClient().
 */

export type UserRole =
  | 'SUPER_ADMIN'
  | 'TENANT_ADMIN'
  | 'PROJECT_MANAGER'
  | 'DEVELOPER'
  | 'APPROVER'
  | 'VIEWER';

export type User = {
  id: string;
  email: string | null;
  display_name: string;
  role: UserRole;
  state: 'ACTIVE' | 'SUSPENDED' | 'INVITED' | 'SERVICE';
  last_login_at: string | null;
};

/** Columns any caller may read. password_hash is not one of them. */
const USER_COLUMNS = 'id, email, display_name, role, state, last_login_at';

/**
 * Returns the user id on success, or null for a wrong password, an unknown
 * email, a suspended account or one locked by repeated failures. The reason is
 * deliberately not distinguished — that would tell an attacker which emails
 * exist.
 */
export async function verifyPassword(
  email: string,
  password: string,
): Promise<string | null> {
  const { data, error } = await serviceClient().rpc('verify_password', {
    p_email: email,
    p_password: password,
  });
  if (error) throw error;
  return (data as string | null) ?? null;
}

export async function createUser(params: {
  email: string;
  displayName: string;
  password: string;
  role?: UserRole;
}): Promise<string> {
  const { data, error } = await serviceClient().rpc('create_user', {
    p_email: params.email,
    p_display_name: params.displayName,
    p_password: params.password,
    p_role: params.role ?? 'VIEWER',
  });
  if (error) throw error;
  return data as string;
}

export async function setPassword(
  userId: string,
  password: string,
): Promise<void> {
  const { error } = await serviceClient().rpc('set_password', {
    target_user: userId,
    new_password: password,
  });
  if (error) throw error;
}

export async function getUser(userId: string): Promise<User | null> {
  const { data, error } = await serviceClient()
    .from('users')
    .select(USER_COLUMNS)
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data as User | null) ?? null;
}

/** Per-tenant roles for a user, which is what the portal gates screens on. */
export async function getMemberships(userId: string) {
  const { data, error } = await serviceClient()
    .from('tenant_users')
    .select('tenant_id, role, state, tenants(slug, name, status)')
    .eq('user_id', userId)
    .neq('state', 'SUSPENDED');
  if (error) throw error;
  return data ?? [];
}

/**
 * Row-level security resolves the caller from the `agentsync.user_id` session
 * setting, which PostgREST cannot set per request. Queries that should be
 * governed by RLS therefore need a direct PostgreSQL connection that issues
 *
 *   set local agentsync.user_id = '<uuid>';
 *
 * inside the transaction. Everything reached through serviceClient() bypasses
 * RLS, so any tenant scoping on those paths must be applied in the query.
 */
export const RLS_SESSION_SETTING = 'agentsync.user_id';
