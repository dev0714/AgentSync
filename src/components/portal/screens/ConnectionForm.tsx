'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * The plumbing every connection form repeats: post, translate the failure into
 * something a person can act on, then re-read the server-rendered overview so
 * the screen shows what the database actually holds rather than what the form
 * hoped it would.
 */

export const COMMON_MESSAGES: Record<string, string> = {
  NOT_AUTHORISED:
    'Your role cannot change connections for this tenant. A tenant admin can.',
  NO_SUCH_TENANT: 'That tenant no longer exists.',
  SECRET_VALUE_NOT_A_REFERENCE:
    'That looks like the secret itself. Store it in your environment and put its name here, with a scheme — env:MY_SECRET.',
  INTERNAL_ERROR: 'Could not save. Nothing was changed.',
};

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="mono text-[11px] text-muted-2">{label}</span>
      {children}
      {hint ? (
        <span className="text-[11px] text-muted-3" style={{ lineHeight: 1.5 }}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      className="rounded-lg border px-3.5 py-2.5 text-[12.5px] text-danger"
      style={{ borderColor: '#452020', background: '#1A0F0E', lineHeight: 1.5 }}
      role="alert"
    >
      {message}
    </div>
  );
}

export function useConnectionSubmit(
  endpoint: string,
  messages: Record<string, string>,
) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const all = { ...COMMON_MESSAGES, ...messages };

  async function call(
    method: 'POST' | 'DELETE',
    body?: unknown,
    query?: Record<string, string>,
  ): Promise<boolean> {
    setBusy(true);
    setError(null);

    const url = query
      ? `${endpoint}?${new URLSearchParams(query).toString()}`
      : endpoint;

    const response = await fetch(url, {
      method,
      ...(body
        ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        : {}),
    }).catch(() => null);

    setBusy(false);

    if (!response) {
      setError(all.INTERNAL_ERROR);
      return false;
    }
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        detail?: string;
      };
      const message = all[payload.error ?? ''] ?? all.INTERNAL_ERROR;
      setError(payload.detail ? `${message} (${payload.detail})` : message);
      return false;
    }

    router.refresh();
    return true;
  }

  return { busy, error, setError, call };
}
