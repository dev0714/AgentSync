'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Logo } from '@/components/site/Icon';

/** The three gates a project can hold. The brand panel names them. */
const GATES = [
  { name: 'Plan approval', when: 'Before any code' },
  { name: 'Merge approval', when: 'Before the default branch' },
  { name: 'Production approval', when: 'Before customers see it' },
];

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
    <div className="flex min-h-screen bg-canvas text-ink">
      {/* Brand panel — hidden on small screens, where the form is the page. */}
      <aside className="hidden w-[44%] max-w-[640px] flex-col gap-10 bg-night px-16 py-12 text-canvas lg:flex">
        <Link href="/" aria-label="AgentSync home" className="self-start">
          <Logo size={26} tone="paper" decorative />
        </Link>
        <div className="flex-1" />
        <p className="display m-0 text-[44px] leading-[1.04] font-bold tracking-[-0.035em] xl:text-[48px]">
          Nothing merges or deploys until a person you chose approves it.
        </p>
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {GATES.map((g, i) => (
            <li
              key={g.name}
              className="fade-up flex items-center gap-3 rounded-[14px] border border-night-line bg-night-2 px-4 py-3.5"
              style={{ '--d': `${200 + i * 120}ms` } as React.CSSProperties}
            >
              <span className="blink size-2.5 rounded-full bg-gate" />
              <span className="flex-1 text-[15px]">{g.name}</span>
              <span className="mono text-[12px] tracking-[0.04em] text-[#a7a49b] uppercase">
                {g.when}
              </span>
            </li>
          ))}
        </ul>
        <span className="mono text-[12px] tracking-[0.06em] text-[#a7a49b]">
          MULTI-TENANT · HUMAN-GATED · AUDITED END TO END
        </span>
      </aside>

      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="fade-up flex w-full max-w-[400px] flex-col gap-6">
          <Link href="/" aria-label="AgentSync home" className="self-start lg:hidden">
            <Logo size={24} decorative />
          </Link>

          <div className="flex flex-col gap-2">
            <h1 className="display m-0 text-[36px] font-bold tracking-[-0.03em]">Sign in</h1>
            <p className="m-0 text-[16px] leading-[1.5] text-ink-3">
              to the AgentSync control plane. Every approval you give is recorded
              against this account.
            </p>
          </div>

          <form onSubmit={onSubmit} className="flex flex-col gap-5">
            <label htmlFor="email" className="flex flex-col gap-2">
              <span className="text-[14px] font-semibold">Work email</span>
              <input
                id="email"
                type="email"
                autoComplete="username"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="field-input min-h-[50px] text-[16px]"
              />
            </label>

            <label htmlFor="password" className="flex flex-col gap-2">
              <span className="text-[14px] font-semibold">Password</span>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="field-input min-h-[50px] text-[16px]"
              />
            </label>

            {error ? (
              <div
                role="alert"
                className="rounded-xl border border-[#e7b8b2] bg-danger-tint px-3.5 py-3 text-[14px] leading-[1.5] text-danger-ink"
              >
                {error}
              </div>
            ) : null}

            <button type="submit" disabled={busy} className="btn-primary min-h-[52px] w-full text-[16px]">
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="m-0 text-[13.5px] leading-[1.55] text-muted-2">
            Five wrong passwords lock the account for fifteen minutes. Trouble
            signing in? Ask your tenant admin.
          </p>
          <Link href="/" className="self-start text-[14px] text-ink-3 hover:text-accent">
            ← Back to the website
          </Link>
        </div>
      </main>
    </div>
  );
}
