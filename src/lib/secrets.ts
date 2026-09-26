import 'server-only';
import { open, type Sealed } from './crypto';
import { serviceClient } from './supabase';

/**
 * Turns a stored secret reference into the secret itself.
 *
 * Connections hold references, never values:
 *   env:NAME  — an environment variable on this deployment
 *   db:<id>   — a value AgentSync was handed (the one-click GitHub App key),
 *               stored encrypted with AGENTSYNC_ENCRYPTION_KEY
 *
 * This is the one place a reference becomes a value, so adding a secret
 * manager later means adding a scheme here and nowhere else.
 */
export class SecretUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretUnavailable';
  }
}

export async function resolveSecret(reference: string | null | undefined): Promise<string> {
  if (!reference) throw new SecretUnavailable('no secret reference is configured');

  const colon = reference.indexOf(':');
  const scheme = colon > 0 ? reference.slice(0, colon) : '';
  const name = reference.slice(colon + 1);

  if (scheme === 'env') {
    const value = process.env[name];
    if (!value) {
      throw new SecretUnavailable(`environment variable ${name} is not set on this deployment`);
    }
    // Private keys pasted into a single-line env var arrive with literal \n.
    return value.includes('\\n') ? value.replace(/\\n/g, '\n') : value;
  }

  if (scheme === 'db') {
    const { data, error } = await serviceClient().rpc('agentsync_read_secret', { p_id: name });
    if (error) throw error;
    if (!data) throw new SecretUnavailable(`stored secret ${name} is missing or revoked`);
    return open(data as Sealed);
  }

  throw new SecretUnavailable(
    `secret scheme "${scheme || reference}" is not supported — use env:NAME`,
  );
}

/** Like resolveSecret, but null instead of throwing when nothing is configured. */
export async function optionalSecret(reference: string | null | undefined): Promise<string | null> {
  if (!reference) return null;
  try {
    return await resolveSecret(reference);
  } catch {
    return null;
  }
}
