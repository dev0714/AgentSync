'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? 'Sign-in failed.');
        setBusy(false);
        return;
      }

      // Full navigation so the server re-reads the session cookie.
      router.replace('/portal');
      router.refresh();
    } catch {
      setError('Could not reach the server.');
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-6 py-12">
      <div className="w-full max-w-[380px]">
        <Link
          href="/"
          className="mb-8 flex items-center gap-3 no-underline hover:no-underline"
        >
          <div
            className="mono flex size-[26px] items-center justify-center rounded-[7px] bg-accent font-semibold text-canvas"
            style={{ fontSize: 13 }}
          >
            A
          </div>
          <div className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
            AgentSync
          </div>
          <div
            className="mono rounded border border-line px-[7px] py-0.5 text-muted-2"
            style={{ fontSize: 9.5, letterSpacing: '0.08em' }}
          >
            CONTROL PLANE
          </div>
        </Link>

        <div className="card p-6">
          <h1 className="mb-1.5 text-[20px] font-semibold tracking-[-0.02em]">
            Sign in
          </h1>
          <p className="mb-6 text-[13px] text-muted" style={{ lineHeight: 1.55 }}>
            Access is scoped to the tenants you belong to. Every approval you
            grant is recorded against this account.
          </p>

          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="email" className="label">
                EMAIL
              </label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="field-input"
                style={{ fontSize: 13, padding: '9px 11px' }}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="password" className="label">
                PASSWORD
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="field-input"
                style={{ fontSize: 13, padding: '9px 11px' }}
              />
            </div>

            {error ? (
              <div
                role="alert"
                className="rounded-md border px-3 py-2.5 text-[12.5px]"
                style={{
                  borderColor: '#452020',
                  background: '#2A1512',
                  color: '#F08A80',
                  lineHeight: 1.5,
                }}
              >
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={busy}
              className="mt-1 w-full cursor-pointer rounded-lg bg-ink px-4 py-2.5 text-[13.5px] font-semibold text-canvas hover:bg-white disabled:cursor-default disabled:opacity-60"
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>

        <div
          className="mono mt-5 text-center text-muted-3"
          style={{ fontSize: 10, letterSpacing: '0.06em' }}
        >
          AGENTSYNC · A LEADSYNC PLATFORM
        </div>
      </div>
    </div>
  );
}
