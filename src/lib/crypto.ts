import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM for the few secrets AgentSync is handed directly (a GitHub App
 * key from the one-click connection). The key lives only in the deployment
 * environment, so a copy of the database alone cannot decrypt anything.
 */

export type Sealed = { ciphertext: string; iv: string; tag: string };

export function encryptionConfigured(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

function key(): Buffer {
  const raw = process.env.AGENTSYNC_ENCRYPTION_KEY;
  if (!raw) throw new Error('AGENTSYNC_ENCRYPTION_KEY is not set on this deployment');
  const k = Buffer.from(raw, 'base64');
  if (k.length !== 32) throw new Error('AGENTSYNC_ENCRYPTION_KEY must be 32 bytes, base64-encoded');
  return k;
}

export function seal(plaintext: string): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

export function open(sealed: Sealed): string {
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(sealed.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
