'use client';

import { useEffect, useState } from 'react';
import Icon from '@/components/site/Icon';
import { stations } from '@/data/site';

/**
 * The hero pipeline, with one request travelling through it on a loop.
 *
 * Agents' stations light blue and pass quickly; at each "You decide" the
 * request waits visibly longer, then is approved. The server renders it held
 * at the merge gate, and that is also what viewers who ask for reduced motion
 * (or have no JavaScript) see — the animation only starts after mount.
 */

const HELD = stations.map((s) => s.kind).lastIndexOf('gate');
/** What the status pill says while an agent's station is lit. */
const DOING = ['Received', 'Reading the code map', 'Planning', '', 'Building', 'Checking', '', ''];
const APPROVE_MS = 700; // the last part of a gate's dwell reads "Approved"

type Phase = 'done' | 'active' | 'approved' | 'next';

function useRun() {
  const [run, setRun] = useState({ step: HELD, t: 0 });
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setRun({ step: 0, t: 0 });
    const tick = 100;
    const id = setInterval(() => {
      setRun(({ step, t }) =>
        t + tick >= stations[step].ms ? { step: (step + 1) % stations.length, t: 0 } : { step, t: t + tick },
      );
    }, tick);
    return () => clearInterval(id);
  }, []);
  return run;
}

function phaseOf(i: number, step: number, t: number): Phase {
  if (i < step) return 'done';
  if (i > step) return 'next';
  const s = stations[i];
  return s.kind === 'gate' && t >= s.ms - APPROVE_MS ? 'approved' : 'active';
}

function Tile({ i, phase }: { i: number; phase: Phase }) {
  const s = stations[i];
  const base = 'relative flex size-14 shrink-0 items-center justify-center rounded-[18px] transition-colors duration-300 md:size-16 md:rounded-[20px]';
  if (phase === 'next') {
    return (
      <span className={`${base} border-2 border-dashed border-[#b9b3a5] bg-card text-muted-4`}>
        <Icon name={s.icon} size={24} />
      </span>
    );
  }
  if (phase === 'done' || phase === 'approved') {
    const gate = s.kind === 'gate';
    return (
      <span className={`${base} ${gate ? 'bg-gate-tint text-gate-ink' : 'bg-accent text-white'}`}>
        <Icon name="check" size={24} stroke={2.4} />
      </span>
    );
  }
  const tone =
    s.kind === 'gate'
      ? { ring: 'border-gate', fill: 'bg-gate text-white' }
      : s.kind === 'ship'
        ? { ring: 'border-ok', fill: 'bg-ok text-white' }
        : { ring: 'border-accent', fill: 'border-2 border-accent bg-agent-tint text-accent' };
  return (
    <span className="relative flex shrink-0 items-center justify-center">
      <span aria-hidden className={`pulse-ring absolute -inset-2.5 rounded-[26px] border-2 ${tone.ring}`} />
      <span className={`${base} ${tone.fill}`}>
        <Icon name={s.icon} size={24} stroke={1.9} />
      </span>
    </span>
  );
}

function Status({ step, t }: { step: number; t: number }) {
  const s = stations[step];
  const phase = phaseOf(step, step, t);
  const [cls, dot, text] =
    s.kind === 'gate'
      ? phase === 'approved'
        ? ['bg-ok-tint text-ok-ink', 'bg-ok', 'Approved']
        : ['bg-gate-tint text-gate-ink', 'bg-gate blink', 'Waiting for you']
      : s.kind === 'ship'
        ? ['bg-ok-tint text-ok-ink', 'bg-ok', 'Shipped · v2.14.0']
        : ['bg-agent-tint text-agent-ink', 'bg-accent blink', DOING[step]];
  return (
    <span
      aria-live="polite"
      className={`inline-flex h-8 items-center gap-2 rounded-full px-3.5 text-[14px] font-semibold transition-colors duration-300 ${cls}`}
    >
      <span className={`size-2 rounded-full ${dot}`} />
      {text}
    </span>
  );
}

function label(i: number, phase: Phase) {
  const s = stations[i];
  if (s.kind === 'gate' && phase === 'active') return 'Waiting for you…';
  if (s.kind === 'gate' && phase === 'approved') return 'Approved';
  return s.text;
}

function NewPill() {
  return (
    <span className="rounded-full bg-agent-tint px-2 py-0.5 text-[11px] font-semibold text-agent-ink">New</span>
  );
}

export default function LivePipeline() {
  const { step, t } = useRun();
  const progress = (step / (stations.length - 1)) * 100;
  const waiting = stations[step].kind === 'gate' && phaseOf(step, step, t) === 'active';

  return (
    <div className="flex flex-col gap-9 rounded-[28px] border border-line bg-card px-5 py-6 md:px-10 md:pt-8 md:pb-10">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="mono text-[13px] text-muted-2">TICKET-1045</span>
        <span className="text-[15px] font-semibold">Add a status filter to the customer dashboard</span>
        <div className="flex-1" />
        <Status step={step} t={t} />
      </div>

      {/* Wide screens: the stations in a row, joined by a line that fills as the request moves. */}
      <div className="relative hidden lg:block">
        <div aria-hidden className="absolute top-[31px] right-[60px] left-[60px] h-0.5 bg-line-soft">
          <div
            className={`h-full transition-[width,background-color] duration-500 ease-out ${waiting ? 'bg-gate' : 'bg-accent'}`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <ol className="relative m-0 flex list-none justify-between p-0">
          {stations.map((s, i) => {
            const phase = phaseOf(i, step, t);
            return (
              <li
                key={i}
                aria-current={i === step ? 'step' : undefined}
                className="relative flex w-[120px] flex-col items-center gap-3 text-center"
              >
                <Tile i={i} phase={phase} />
                <span
                  className={`flex items-center gap-1.5 text-[15.5px] font-semibold transition-colors duration-300 ${
                    s.kind === 'gate' && phase !== 'next' ? 'text-gate-ink' : phase === 'next' ? 'text-muted-4' : 'text-ink'
                  }`}
                >
                  {s.name}
                </span>
                <span className="min-h-[38px] text-[13px] leading-[1.4] text-muted-2">{label(i, phase)}</span>
                {s.isNew ? <NewPill /> : null}
              </li>
            );
          })}
        </ol>
      </div>

      {/* Narrow screens: the same stations, top to bottom. */}
      <ol className="m-0 flex list-none flex-col p-0 lg:hidden">
        {stations.map((s, i) => {
          const phase = phaseOf(i, step, t);
          return (
            <li key={i} aria-current={i === step ? 'step' : undefined} className="flex gap-4">
              <div className="flex flex-col items-center">
                <Tile i={i} phase={phase} />
                {i < stations.length - 1 ? (
                  <span
                    aria-hidden
                    className={`my-1 h-4 w-0.5 transition-colors duration-300 ${i < step ? 'bg-accent' : 'bg-line-soft'}`}
                  />
                ) : null}
              </div>
              <div className="flex flex-col gap-1 pt-2.5">
                <span className={`flex items-center gap-2 text-[16px] font-semibold ${s.kind === 'gate' ? 'text-gate-ink' : ''}`}>
                  {s.name}
                  {s.isNew ? <NewPill /> : null}
                </span>
                <span className="text-[14px] leading-[1.45] text-muted-2">{label(i, phase)}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
