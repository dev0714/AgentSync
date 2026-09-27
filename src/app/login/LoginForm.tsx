'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Logo } from '@/components/site/Icon';
import ThemeToggle from '@/components/portal/ThemeToggle';
import ThemedLogo from '@/components/portal/ThemedLogo';

/** What the colours mean everywhere in the control plane. */
const LEGEND = [
  { colour: '#4c8dff', text: 'Blue: an agent is working' },
  { colour: '#f08a4b', text: 'Orange: a person needs to decide' },
  { colour: '#6fd39c', text: 'Green: done and released' },
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

      // Back to where sign-in was asked for (e.g. a one-click connection),
      // but only ever to a path on this site.
      const next = new URLSearchParams(window.location.search).get('next');
      const target = next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/portal';
      // Full navigation so the server re-reads the session cookie.
      router.replace(target);
      router.refresh();
    } catch {
      setError('Could not reach the server.');
      setBusy(false);
    }
  }

  return (
    <div className="portal-ui flex min-h-screen bg-canvas text-ink">
      {/* Brand panel — hidden on small screens, where the form is the page.
          It stays dark in both themes. */}
      <aside className="hidden w-[44%] max-w-[620px] flex-col gap-10 bg-[#0e1014] px-14 py-12 text-[#eceef2] lg:flex">
        <Link href="/" aria-label="AgentSync home" className="self-start">
          <Logo size={24} tone="paper" decorative />
        </Link>
        <div className="flex flex-1 flex-col justify-center gap-5">
          <p className="m-0 text-[38px] leading-[1.15] font-semibold tracking-[-0.03em]">
            Every change your agents make — planned, approved and on record.
          </p>
          <p className="m-0 max-w-[460px] text-[16px] leading-[1.6] text-[#a8adb8]">
            Requests come in from your systems. Agents plan and build them. Nothing is built or
            merged until a person on your team says so.
          </p>
        </div>
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {LEGEND.map((l) => (
            <li key={l.text} className="flex items-center gap-3 text-[14px] text-[#c4c8d0]">
              <span className="size-2 rounded-full" style={{ background: l.colour }} />
              {l.text}
            </li>
          ))}
        </ul>
      </aside>

      <main className="flex flex-1 flex-col px-6 py-6 sm:px-10">
        <div className="flex justify-end">
          <ThemeToggle />
        </div>
        <div className="flex flex-1 items-center justify-center py-8">
          <div className="fade-up flex w-full max-w-[380px] flex-col gap-6">
            <Link href="/" aria-label="AgentSync home" className="self-start lg:hidden">
              <ThemedLogo size={22} />
            </Link>

            <div className="flex flex-col gap-1.5">
              <h1 className="m-0 text-[26px] font-semibold tracking-[-0.02em]">Sign in</h1>
              <p className="m-0 text-[14.5px] leading-[1.5] text-muted-3">
                Use the email your AgentSync admin invited. Every approval you give is recorded
                against this account.
              </p>
            </div>

            <form onSubmit={onSubmit} className="flex flex-col gap-[18px]">
              <label htmlFor="email" className="flex flex-col gap-1.5">
                <span className="text-[13.5px] font-medium">Email</span>
                <input
                  id="email"
                  type="email"
                  autoComplete="username"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="field-input min-h-[44px] text-[15px]"
                />
              </label>

              <label htmlFor="password" className="flex flex-col gap-1.5">
                <span className="text-[13.5px] font-medium">Password</span>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="field-input min-h-[44px] text-[15px]"
                />
              </label>

              {error ? (
                <div
                  role="alert"
                  className="rounded-lg border border-danger-line bg-danger-tint px-3.5 py-3 text-[14px] leading-[1.5] text-danger-ink"
                >
                  {error}
                </div>
              ) : null}

              <button type="submit" disabled={busy} className="btn-primary min-h-[46px] w-full text-[15px]">
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </form>

            <p className="m-0 text-[13px] leading-[1.55] text-muted-3">
              Five wrong passwords lock the account for fifteen minutes. No account, or trouble
              signing in? Ask your team’s AgentSync admin.
            </p>
            <Link href="/" className="self-start text-[13.5px] text-ink-3 hover:text-accent">
              ← Back to the website
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
