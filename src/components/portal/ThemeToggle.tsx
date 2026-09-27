'use client';

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

const KEY = 'agentsync-theme';

function current(): Theme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

/**
 * Light / Dark for the control plane. The choice is kept in this browser and
 * applied before first paint by the root layout's script; until someone
 * chooses, the system setting decides (and changes with it).
 */
export default function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    setTheme(current());
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const follow = () => {
      let saved: string | null = null;
      try {
        saved = localStorage.getItem(KEY);
      } catch {
        saved = null;
      }
      if (saved === 'light' || saved === 'dark') return;
      const next: Theme = media.matches ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      setTheme(next);
    };
    media.addEventListener('change', follow);
    return () => media.removeEventListener('change', follow);
  }, []);

  function choose(next: Theme) {
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // private mode: the choice lasts for this page only
    }
    setTheme(next);
  }

  const option = (value: Theme, label: string, icon: React.ReactNode) => {
    const on = theme === value;
    return (
      <button
        type="button"
        aria-pressed={on}
        onClick={() => choose(value)}
        className={`flex h-7 cursor-pointer items-center gap-1.5 rounded-[5px] px-2.5 text-[12.5px] font-medium ${
          on ? 'bg-card text-ink shadow-[0_1px_2px_rgba(17,19,24,0.12)] dark-ring' : 'text-muted-3 hover:text-ink'
        }`}
      >
        {icon}
        <span className="hidden sm:inline">{label}</span>
        <span className="sr-only sm:hidden">{label} theme</span>
      </button>
    );
  };

  return (
    <div role="group" aria-label="Theme" className={`flex gap-0.5 rounded-lg border border-line-soft bg-raised p-[3px] ${className}`}>
      {option(
        'light',
        'Light',
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>,
      )}
      {option(
        'dark',
        'Dark',
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
        </svg>,
      )}
    </div>
  );
}
