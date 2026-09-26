import 'server-only';

/**
 * Turns a stored secret reference into the secret itself.
 *
 * The database only ever holds references (`env:GITHUB_APP_PRIVATE_KEY`), never
 * values — `agentsync.is_secret_reference` refuses anything else. This is the
 * one place a reference becomes a value, so adding a secret manager later means
 * adding a scheme here and nowhere else.
 */
export class SecretUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretUnavailable';
  }
}

export function resolveSecret(reference: string | null | undefined): string {
  if (!reference) throw new SecretUnavailable('no secret reference is configured');

  const colon = reference.indexOf(':');
  const scheme = colon > 0 ? reference.slice(0, colon) : '';
  const name = reference.slice(colon + 1);

  if (scheme === 'env') {
    const value = process.env[name];
    if (!value) {
      throw new SecretUnavailable(
        `environment variable ${name} is not set on this deployment`,
      );
    }
    // Private keys pasted into a single-line env var arrive with literal \n.
    return value.includes('\\n') ? value.replace(/\\n/g, '\n') : value;
  }

  throw new SecretUnavailable(
    `secret scheme "${scheme || reference}" is not supported yet — use env:NAME`,
  );
}

/** Like resolveSecret, but null instead of throwing when nothing is configured. */
export function optionalSecret(reference: string | null | undefined): string | null {
  if (!reference) return null;
  try {
    return resolveSecret(reference);
  } catch {
    return null;
  }
}
