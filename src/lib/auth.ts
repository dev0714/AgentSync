import 'server-only';
import { cookies } from 'next/headers';
import { serviceClient } from './supabase';
import { SESSION_COOKIE, verifySession } from './session';

/**
 * Identity for AgentSync, backed by agentsync.users rather than Supabase Auth.
 *
 * Password hashing and comparison happen inside PostgreSQL (bcrypt, via
 * agentsync.set_password / agentsync.verify_password), so plaintext never
 * reaches application logs and the hash never leaves the database. Those
 * helpers are exposed to the app through public.agentsync_* wrappers granted to
 * the service role only, which is why every call here uses serviceClient().
 */

export type UserRole =
  | 'SUPER_ADMIN'
  | 'TENANT_ADMIN'
  | 'PROJECT_MANAGER'
  | 'DEVELOPER'
  | 'APPROVER'
  | 'VIEWER';

export type Membership = {
  tenant_id: string;
  slug: string;
  name: string;
  role: UserRole;
};

export type SessionUser = {
  id: string;
  email: string | null;
  display_name: string;
  role: UserRole;
  state: 'ACTIVE' | 'SUSPENDED' | 'INVITED' | 'SERVICE';
  last_login_at: string | null;
  memberships: Membership[];
};

/**
 * Returns the user id on success, or null for a wrong password, an unknown
 * email, a suspended account, or one locked by repeated failures. The reason is
 * deliberately not distinguished — that would tell an attacker which addresses
 * have accounts.
 */
export async function verifyPassword(
  email: string,
  password: string,
): Promise<string | null> {
  const { data, error } = await serviceClient().rpc(
    'agentsync_verify_password',
    { p_email: email, p_password: password },
  );
  if (error) throw error;
  return (data as string | null) ?? null;
}

export async function getSessionUser(
  userId: string,
): Promise<SessionUser | null> {
  const { data, error } = await serviceClient().rpc('agentsync_session_user', {
    p_user_id: userId,
  });
  if (error) throw error;
  return (data as SessionUser | null) ?? null;
}

export async function createUser(params: {
  email: string;
  displayName: string;
  password: string;
  role?: UserRole;
}): Promise<string> {
  const { data, error } = await serviceClient().rpc('agentsync_create_user', {
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
  const { error } = await serviceClient().rpc('agentsync_set_password', {
    p_user_id: userId,
    p_password: password,
  });
  if (error) throw error;
}

/**
 * The signed-in user for the current request, or null. The cookie carries only
 * a user id, so the role and tenant memberships are re-read from the database
 * every time and cannot be forged by editing the cookie.
 */
export async function currentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return null;
  return getSessionUser(session.sub);
}
