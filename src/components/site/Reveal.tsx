'use client';

import { useEffect, useRef } from 'react';

/**
 * Scroll reveal for everything inside it marked `.rv`.
 *
 * Content is visible by default. It is hidden for the reveal only once this
 * runs and has confirmed an IntersectionObserver exists to bring it back, and
 * never when the viewer has asked their system to reduce motion. So a
 * browser without JS, or one that fails here, shows the whole page as-is.
 *
 * Each `.rv` gets `data-in` the first time it scrolls into view, and is then
 * left alone: a section does not re-hide when scrolled past.
 */
export default function Reveal({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || typeof IntersectionObserver === 'undefined') return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.setAttribute('data-in', '');
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' },
    );

    el.setAttribute('data-anim', '');
    el.querySelectorAll('.rv').forEach((node) => io.observe(node));
    return () => io.disconnect();
  }, []);

  return (
    <div ref={root} className={className}>
      {children}
    </div>
  );
}
