/**
 * Session cookie: a signed, self-contained token.
 *
 * Format is `<base64url(payload)>.<base64url(hmac-sha256)>`. It carries only the
 * user id and an expiry — never a role or a tenant, because those are read from
 * the database on each request and must not be forgeable by editing a cookie.
 *
 * Uses Web Crypto only, so the same code verifies in Edge middleware and in
 * Node route handlers.
 */

export const SESSION_COOKIE = 'agentsync_session';

/** Eight hours. A signed-out-by-morning default. */
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

export type SessionPayload = {
  /** user id */
  sub: string;
  /** expiry, seconds since the epoch */
  exp: number;
};

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) {
    throw new Error(
      'AUTH_SECRET is missing or shorter than 32 characters. Generate one with `openssl rand -base64 32`.',
    );
  }
  return value;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function key(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function signSession(userId: string): Promise<string> {
  const payload: SessionPayload = {
    sub: userId,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS,
  };
  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign(
    'HMAC',
    await key(),
    new TextEncoder().encode(body),
  );
  return `${body}.${toBase64Url(new Uint8Array(signature))}`;
}

/**
 * Returns the payload for a token with a valid signature that has not expired,
 * and null for anything else. Signature verification happens before the payload
 * is trusted, and comparison is done by crypto.subtle.verify rather than by
 * string equality.
 */
export async function verifySession(
  token: string | undefined,
): Promise<SessionPayload | null> {
  if (!token) return null;

  const [body, signature] = token.split('.');
  if (!body || !signature) return null;

  let valid: boolean;
  try {
    valid = await crypto.subtle.verify(
      'HMAC',
      await key(),
      fromBase64Url(signature),
      new TextEncoder().encode(body),
    );
  } catch {
    return null;
  }
  if (!valid) return null;

  try {
    const payload = JSON.parse(
      new TextDecoder().decode(fromBase64Url(body)),
    ) as SessionPayload;
    if (!payload.sub || typeof payload.exp !== 'number') return null;
    if (payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
