import 'server-only';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Signed, expiring values carried through GitHub's App-creation redirects.
 *
 * The one-click flow leaves AgentSync twice (create the App, install it) and
 * comes back each time; these tie the return to the person and tenant who
 * started it, so a redirect cannot be replayed or finished by someone else.
 */

export type Pending = {
  user_id: string;
  tenant_slug: string;
  exp: number;
  nonce?: string;
  app_id?: number;
  slug?: string;
  key_ref?: string;
};

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error('AUTH_SECRET is not configured');
  return s;
}

export function signPending(value: Omit<Pending, 'exp' | 'nonce'>, ttlSeconds = 3600): string {
  const body = Buffer.from(
    JSON.stringify({ ...value, exp: Date.now() + ttlSeconds * 1000, nonce: randomBytes(8).toString('hex') }),
  ).toString('base64url');
  const mac = createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function verifyPending(token: string | null | undefined, userId: string): Pending | null {
  if (!token) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = createHmac('sha256', secret()).update(body).digest();
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const value = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Pending;
    if (value.exp < Date.now() || value.user_id !== userId) return null;
    return value;
  } catch {
    return null;
  }
}

export const PENDING_COOKIE = 'agentsync_github_setup';
