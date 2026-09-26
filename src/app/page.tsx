import Link from 'next/link';
import Icon, { Logo } from '@/components/site/Icon';
import Reveal from '@/components/site/Reveal';
import {
  agents,
  checks,
  controls,
  denies,
  evidence,
  gates,
  integrations,
  nav,
  requestTypes,
  sources,
  stations,
} from '@/data/site';

/*
 * The public site. Server-rendered; the only client code is <Reveal>, which
 * adds scroll reveals to anything marked `.rv`. All motion is defined in
 * globals.css and switches off for viewers who ask for reduced motion.
 *
 * Colour carries meaning here: blue is the agent working, orange is a person
 * deciding. The eye should find every orange thing on the page and understand
 * the product from those alone.
 */

const wrap = 'mx-auto w-full max-w-[1200px] px-5 md:px-10';
const eyebrow = 'mono text-[12px] tracking-[0.08em] text-muted-2';
const cssVar = (ms: number) => ({ '--d': `${ms}ms` }) as React.CSSProperties;

export default function Home() {
  return (
    <Reveal className="min-h-screen bg-canvas text-ink">
      <SiteNav />
      <Hero />
      <Sources />
      <HowItWorks />
      <WhatComesBack />
      <Guardrails />
      <Integrations />
      <RequestTypes />
      <CallToAction />
    </Reveal>
  );
}

/* ---- nav ------------------------------------------------------------- */

function SiteNav() {
  return (
    <nav className="sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur-md">
      <div className={`${wrap} flex h-[72px] items-center gap-8 md:h-[84px]`}>
        <Link href="/" aria-label="AgentSync home" className="no-underline">
          <Logo size={28} decorative />
        </Link>
        <div className="hidden gap-7 text-[15px] lg:flex">
          {nav.map((n) => (
            <a key={n.href} href={n.href} className="text-ink-2 hover:text-accent">
              {n.label}
            </a>
          ))}
        </div>
        <div className="flex-1" />
        <Link
          href="/login"
          className="hidden text-[15px] font-medium text-ink hover:text-accent sm:inline"
        >
          Sign in
        </Link>
        <a href="#start" className="btn-primary btn-lift hidden sm:inline-flex">
          Request access
        </a>

        {/* Small screens: a disclosure, so the menu works with no JavaScript. */}
        <details className="relative lg:hidden">
          <summary
            aria-label="Open menu"
            className="flex size-11 cursor-pointer list-none items-center justify-center rounded-xl border border-line bg-card text-ink [&::-webkit-details-marker]:hidden"
          >
            <Icon name="menu" />
          </summary>
          <div className="absolute right-0 mt-2 flex w-60 flex-col rounded-2xl border border-line bg-card p-2 shadow-[0_24px_48px_-24px_rgba(21,22,26,0.45)]">
            {nav.map((n) => (
              <a
                key={n.href}
                href={n.href}
                className="rounded-xl px-3 py-3 text-[15px] text-ink hover:bg-raised"
              >
                {n.label}
              </a>
            ))}
            <Link
              href="/login"
              className="rounded-xl px-3 py-3 text-[15px] text-ink hover:bg-raised"
            >
              Sign in
            </Link>
            <a href="#start" className="btn-primary mt-1">
              Request access
            </a>
          </div>
        </details>
      </div>
      <span
        aria-hidden
        className="scroll-progress absolute inset-x-0 -bottom-px h-0.5 bg-accent"
      />
    </nav>
  );
}

/* ---- hero ------------------------------------------------------------ */

function Hero() {
  return (
    <section className={`${wrap} flex flex-col gap-7 pt-12 pb-16 md:gap-8 md:pt-[72px] md:pb-[88px]`}>
      <span className="fade-up mono inline-flex h-[34px] items-center gap-2.5 self-start rounded-full border border-line bg-card px-3.5 text-[11px] tracking-[0.04em] text-ink-2 md:text-[12.5px]">
        <span className="blink size-2 rounded-full bg-gate" />
        MULTI-TENANT · HUMAN-GATED · AUDITED END TO END
      </span>

      <h1 className="display m-0 text-[46px] leading-[1] font-bold tracking-[-0.04em] sm:text-[64px] lg:text-[88px] lg:leading-[0.98]">
        <span className="line">
          <span className="rise" style={cssVar(80)}>
            Requests in.{' '}
          </span>
        </span>
        <span className="line">
          <span className="rise" style={cssVar(220)}>
            <span className="text-accent">Reviewed pull requests</span> out.
          </span>
        </span>
      </h1>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:gap-16">
        <p
          className="fade-up m-0 max-w-[640px] text-[17px] leading-[1.55] text-ink-3 md:text-[20px]"
          style={cssVar(420)}
        >
          AgentSync takes a development request from any system you run, plans
          it, builds it on an isolated branch and runs your own checks.{' '}
          <strong className="font-semibold text-ink">
            Nothing merges or deploys until the people you choose approve it.
          </strong>
        </p>
        <div className="flex-1" />
        <div className="fade-up flex flex-col gap-3 sm:flex-row" style={cssVar(560)}>
          <a href="#start" className="btn-primary btn-lift min-h-[56px] px-7 text-[17px] whitespace-nowrap">
            Request access
          </a>
          <Link
            href="/portal"
            className="btn btn-lift min-h-[56px] border-[1.5px] border-ink px-6 text-[17px] whitespace-nowrap text-ink hover:text-ink"
          >
            See the control plane
            <Icon name="arrow" size={18} stroke={2} className="nudge" />
          </Link>
        </div>
      </div>

      <Pipeline />
    </section>
  );
}

function StationTile({ icon, kind }: { icon: (typeof stations)[number]['icon']; kind: string }) {
  if (kind === 'gate') {
    return (
      <span className="relative flex size-16 shrink-0 items-center justify-center">
        <span aria-hidden className="pulse-ring absolute -inset-2.5 rounded-[28px] border-2 border-gate" />
        <span aria-hidden className="absolute -inset-2.5 rounded-[28px] border-2 border-gate-tint" />
        <span className="relative flex size-16 items-center justify-center rounded-[20px] bg-gate text-white">
          <Icon name={icon} size={26} stroke={1.9} />
        </span>
      </span>
    );
  }
  if (kind === 'next') {
    return (
      <span className="flex size-16 shrink-0 items-center justify-center rounded-[20px] border-2 border-dashed border-[#b9b3a5] bg-card text-muted-4">
        <Icon name={icon} size={26} />
      </span>
    );
  }
  return (
    <span className="flex size-16 shrink-0 items-center justify-center rounded-[20px] border-2 border-accent bg-agent-tint text-accent">
      <Icon name={icon} size={26} />
    </span>
  );
}

function Pipeline() {
  return (
    <div
      className="rv mt-4 flex flex-col gap-9 rounded-[28px] border border-line bg-card px-5 py-6 md:px-12 md:pt-8 md:pb-10"
      style={cssVar(300)}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="mono text-[13px] text-muted-2">TICKET-1045</span>
        <span className="text-[15px] font-semibold">
          Add a status filter to the customer dashboard
        </span>
        <div className="flex-1" />
        <span className="inline-flex h-8 items-center gap-2 rounded-full bg-gate-tint px-3.5 text-[14px] font-semibold text-gate-ink">
          <span className="blink size-2 rounded-full bg-gate" />
          Waiting for you
        </span>
      </div>

      {/* Wide screens: the stations in a row, joined by a line the request travels along. */}
      <div className="relative hidden lg:block">
        <div aria-hidden className="absolute top-[31px] right-[68px] left-[68px] h-0.5 bg-line-soft">
          <div className="draw absolute inset-y-0 left-0 w-[83.333%] bg-accent" />
          <div className="travel absolute -top-[7px] -ml-2 size-4 rounded-full border-[3px] border-accent bg-card" />
        </div>
        <ol className="relative m-0 flex list-none justify-between p-0">
        {stations.map((s, i) => (
          <li
            key={s.name}
            className="rv pop relative flex w-[136px] flex-col items-center gap-3 text-center"
            style={cssVar(450 + i * 110)}
          >
            <StationTile icon={s.icon} kind={s.kind} />
            <span
              className={`text-[16px] ${s.kind === 'gate' ? 'font-bold text-gate-ink' : s.kind === 'next' ? 'font-semibold text-ink-3' : 'font-semibold'}`}
            >
              {s.name}
            </span>
            <span className="text-[13.5px] leading-[1.4] text-muted-2">{s.text}</span>
          </li>
        ))}
        </ol>
      </div>

      {/* Narrow screens: the same stations, top to bottom. */}
      <ol className="m-0 flex list-none flex-col p-0 lg:hidden">
        {stations.map((s, i) => (
          <li key={s.name} className="rv from-left flex gap-4" style={cssVar(300 + i * 110)}>
            <div className="flex flex-col items-center">
              <StationTile icon={s.icon} kind={s.kind} />
              {i < stations.length - 1 ? (
                <span
                  aria-hidden
                  className={`my-1 h-4 w-0.5 ${s.kind === 'done' ? 'bg-accent' : 'bg-line-soft'}`}
                />
              ) : null}
            </div>
            <div className="flex flex-col gap-1 pt-3">
              <span className={`text-[16px] font-semibold ${s.kind === 'gate' ? 'text-gate-ink' : ''}`}>
                {s.name}
              </span>
              <span className="text-[14px] leading-[1.45] text-muted-2">{s.text}</span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ---- sources marquee ------------------------------------------------- */

function Sources() {
  const row = (hidden: boolean) => (
    <div
      aria-hidden={hidden || undefined}
      className="display flex items-center gap-11 pr-11 text-[22px] font-semibold whitespace-nowrap md:text-[28px]"
    >
      {sources.map((s) => (
        <span key={s} className="flex items-center gap-11">
          <span>{s}</span>
          <span aria-hidden className="size-2 rounded-full bg-accent" />
        </span>
      ))}
    </div>
  );
  return (
    <div className="rv flex flex-col gap-3 overflow-hidden border-y border-line bg-canvas-alt py-6">
      <div className={wrap}>
        <span className={eyebrow}>TAKES WORK FROM</span>
      </div>
      <div className="min-w-0 overflow-hidden">
        <div className="marquee flex w-max">
          {row(false)}
          {row(true)}
        </div>
      </div>
    </div>
  );
}

/* ---- how it works ---------------------------------------------------- */

function HowItWorks() {
  return (
    <section id="how" className={`${wrap} flex scroll-mt-24 flex-col gap-12 py-20 md:py-24`}>
      <div className="rv flex flex-col gap-6 lg:flex-row lg:items-end lg:gap-16">
        <div className="flex flex-col gap-4">
          <span className={eyebrow}>HOW IT WORKS</span>
          <h2 className="display m-0 text-[38px] leading-[1.02] font-bold md:text-[56px]">
            Three moves.
            <br />
            You own the last one.
          </h2>
        </div>
        <div className="flex-1" />
        <p className="m-0 max-w-[420px] text-[17px] leading-[1.6] text-ink-3">
          No new tool for your team to learn. Requests arrive from the systems
          they already use, and the answer comes back as a pull request.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <article className="rv lift flex flex-col gap-4 rounded-3xl border border-line bg-card p-7 md:p-8" style={cssVar(0)}>
          <span className="display text-[44px] leading-none font-bold text-accent">01</span>
          <h3 className="m-0 text-[22px] leading-tight font-semibold md:text-[24px]">Any system sends a request</h3>
          <p className="m-0 text-[16px] leading-[1.6] text-ink-3">
            A service desk, an intake form, a CRM, a cron job or another agent.
            One signed call — and a retry never creates a second task.
          </p>
          <pre className="mono m-0 mt-2 overflow-x-auto rounded-2xl bg-night p-5 text-[12.5px] leading-[1.75] text-[#c9c6bd]">
            {'POST /api/v1/agent/tasks\n'}
            <span className="text-[#8e9098]">{'Authorization: Bearer ask_live_…\n'}</span>
            {'{\n  "idempotency_key": '}
            <span className="text-[#a9c4ff]">{'"TICKET-1045"'}</span>
            {',\n  "request_type": "code_change",\n  "title": "Add a status filter…"\n}\n'}
            <span className="chip inline-block text-[#f4b894]" style={cssVar(700)}>
              {'→ 202  queued'}
            </span>
          </pre>
        </article>

        <article className="rv lift flex flex-col gap-4 rounded-3xl border border-line bg-card p-7 md:p-8" style={cssVar(140)}>
          <span className="display text-[44px] leading-none font-bold text-accent">02</span>
          <h3 className="m-0 text-[22px] leading-tight font-semibold md:text-[24px]">Five agents do the work</h3>
          <p className="m-0 text-[16px] leading-[1.6] text-ink-3">
            Each has one job, its own tools and its own limits. None of them can
            approve its own output.
          </p>
          <ul className="m-0 mt-2 flex list-none flex-col rounded-2xl border border-line-soft p-0">
            {agents.map((a, i) => (
              <li
                key={a.name}
                className="flex items-center gap-3 border-b border-line-soft px-4.5 py-3.5 last:border-b-0"
              >
                <span aria-hidden className="work size-2 rounded-full bg-accent" style={cssVar(i * 600)} />
                <span className="text-[15px] font-semibold">{a.name}</span>
                <div className="flex-1" />
                <span className="mono text-[11.5px] text-muted-2">{a.out}</span>
              </li>
            ))}
          </ul>
        </article>

        <article className="rv lift flex flex-col gap-4 rounded-3xl border border-gate bg-gate-tint p-7 md:p-8" style={cssVar(280)}>
          <span className="display text-[44px] leading-none font-bold text-gate-ink">03</span>
          <h3 className="m-0 text-[22px] leading-tight font-semibold md:text-[24px]">You approve at the gates you choose</h3>
          <p className="m-0 text-[16px] leading-[1.6] text-ink-3">
            Set per project. Start with every gate on, and loosen them once the
            record earns it.
          </p>
          <div className="mt-2 flex flex-col gap-2.5">
            {gates.map((g, i) => (
              <div key={g.label} className="flex items-center gap-3.5 rounded-2xl bg-card px-4.5 py-3.5">
                <span className="flex-1 text-[15px] font-medium">{g.label}</span>
                <span
                  role="img"
                  aria-label={`${g.label}: on`}
                  className="sw flex h-[26px] w-11 justify-end rounded-full bg-gate p-[3px]"
                  style={cssVar(700 + i * 200)}
                >
                  <span className="knob size-5 rounded-full bg-white" />
                </span>
              </div>
            ))}
            <div className="flex items-center gap-3.5 rounded-2xl bg-card px-4.5 py-3.5">
              <span className="flex-1 text-[15px] font-medium text-muted-2">Agent merges its own PR</span>
              <Icon name="lock" size={16} stroke={2} className="text-muted-2" />
              <span
                role="img"
                aria-label="Agent merges its own PR: off and locked"
                className="flex h-[26px] w-11 justify-start rounded-full bg-[#c9c4b7] p-[3px]"
              >
                <span className="size-5 rounded-full bg-white" />
              </span>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}

/* ---- what comes back ------------------------------------------------- */

function WhatComesBack() {
  return (
    <section className="bg-canvas-alt">
      <div className={`${wrap} grid grid-cols-1 items-center gap-12 py-20 md:py-24 lg:grid-cols-2 lg:gap-20`}>
        <div className="rv flex flex-col gap-5">
          <span className={eyebrow}>WHAT COMES BACK</span>
          <h2 className="display m-0 text-[36px] leading-[1.04] font-bold md:text-[48px]">
            A pull request, with the evidence stapled to it.
          </h2>
          <p className="m-0 text-[17px] leading-[1.6] text-ink-3">
            Reviewers see why the change was made and proof that it works, before
            they read a line of the diff.
          </p>
          <ul className="m-0 mt-2 flex list-none flex-col gap-3.5 p-0">
            {evidence.map((e, i) => (
              <li key={e} className="chip flex items-start gap-3.5" style={cssVar(300 + i * 150)}>
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-agent-tint text-agent-ink">
                  <Icon name="check" size={15} stroke={2.4} />
                </span>
                <span className="text-[16px] leading-[1.55]">{e}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rv lift overflow-hidden rounded-3xl border border-line bg-card" style={cssVar(150)}>
          <div className="flex items-center gap-3 border-b border-line-soft px-6 py-4.5">
            <span className="mono text-[12.5px] text-muted-2">TICKET-1045</span>
            <div className="flex-1" />
            <span className="mono text-[12px] tracking-[0.06em] text-muted-2">EXAMPLE RESULT</span>
          </div>
          <dl className="m-0 px-6 py-2 text-[15px]">
            <Row label="Branch">
              <span className="mono text-[13.5px] break-all">ai/ticket-1045-status-filter</span>
            </Row>
            <Row label="Files">
              <span>6 changed</span>
              <span className="mono ml-3 text-[13.5px] text-ok">+148</span>
              <span className="mono ml-2 text-[13.5px] text-danger">−23</span>
            </Row>
            <Row label="Checks">
              <span className="flex flex-wrap gap-1.5">
                {checks.map((c, i) => (
                  <span
                    key={c}
                    className="chip rounded-lg bg-ok-tint px-2.5 py-1 text-[13px] font-semibold text-ok-ink"
                    style={cssVar(500 + i * 150)}
                  >
                    {c}
                  </span>
                ))}
              </span>
            </Row>
            <Row label="Pull request">
              <span className="font-semibold text-agent-ink">#45 opened</span>
            </Row>
            <Row label="Preview" last>
              <span className="mono text-[13.5px] break-all text-agent-ink">…git-ai-ticket-1045.vercel.app</span>
            </Row>
          </dl>
          <div
            className="chip flex flex-wrap items-center gap-3 border-t border-gate bg-gate-tint px-6 py-4.5"
            style={cssVar(1200)}
          >
            <span className="blink size-2.5 rounded-full bg-gate" />
            <span className="font-semibold text-gate-ink">Awaiting merge approval</span>
            <div className="flex-1" />
            <span className="text-[14px] text-ink-3">Held for a human. Nothing merged.</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function Row({
  label,
  children,
  last = false,
}: {
  label: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div className={`flex items-center gap-4 py-3 ${last ? '' : 'border-b border-line-faint'}`}>
      <dt className="w-[110px] shrink-0 text-muted-2">{label}</dt>
      <dd className="m-0 flex min-w-0 items-center">{children}</dd>
    </div>
  );
}

/* ---- guardrails ------------------------------------------------------ */

function Guardrails() {
  return (
    <section id="guardrails" className="scroll-mt-24 bg-night text-canvas">
      <div className={`${wrap} flex flex-col gap-14 py-20 md:py-[104px]`}>
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:gap-20">
          <div className="rv flex flex-col gap-5">
            <span className="mono text-[12px] tracking-[0.08em] text-[#a7a49b]">GUARDRAILS</span>
            <h2 className="display m-0 text-[38px] leading-[1.02] font-bold md:text-[56px]">
              Hard limits,
              <br />
              not polite requests.
            </h2>
            <p className="m-0 max-w-[460px] text-[17px] leading-[1.6] text-[#c9c6bd]">
              These are platform rules, not instructions in a prompt. An agent
              cannot talk its way past them, and every attempt is written to the
              audit log.
            </p>
          </div>
          <div className="flex flex-col">
            <span className="rv mono mb-3 text-[12px] tracking-[0.08em] text-[#a7a49b]">
              AGENTSYNC WILL NEVER
            </span>
            <ul className="m-0 list-none p-0">
              {denies.map((d, i) => (
                <li
                  key={d}
                  className="rv from-left flex gap-3.5 border-b border-night-line py-3 last:border-b-0"
                  style={cssVar(i * 70)}
                >
                  <Icon name="x" size={20} stroke={2} className="mt-px shrink-0 text-[#f4b894]" />
                  <span className="text-[16px] leading-[1.5]">{d}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {controls.map((c, i) => (
            <div
              key={c.title}
              className="rv lift flex flex-col gap-3 rounded-[20px] border border-night-line bg-night-2 p-6"
              style={cssVar(i * 100)}
            >
              <h3 className="m-0 text-[18px] font-semibold">{c.title}</h3>
              <p className="m-0 text-[14.5px] leading-[1.6] text-[#c9c6bd]">{c.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---- integrations ---------------------------------------------------- */

const TONE: Record<string, string> = {
  ok: 'text-ok-ink',
  gate: 'text-gate-ink',
  agent: 'text-agent-ink',
};

function Integrations() {
  return (
    <section id="integrations" className={`${wrap} flex scroll-mt-24 flex-col gap-12 py-20 md:py-24`}>
      <div className="rv flex flex-col gap-4">
        <span className={eyebrow}>INTEGRATIONS</span>
        <h2 className="display m-0 text-[36px] leading-[1.04] font-bold md:text-[48px]">
          Works with the stack you already run.
        </h2>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {integrations.map((it, i) => (
          <div
            key={it.name}
            className="rv lift flex flex-col gap-3 rounded-[20px] border border-line bg-card p-7"
            style={cssVar(i * 90)}
          >
            <div className="flex items-center gap-2.5">
              <span className="text-[20px] font-bold">{it.name}</span>
              <div className="flex-1" />
              <span className={`text-[13px] font-semibold ${TONE[it.tone]}`}>{it.status}</span>
            </div>
            <p className="m-0 text-[15px] leading-[1.6] text-ink-3">{it.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---- request types --------------------------------------------------- */

function RequestTypes() {
  return (
    <section id="types" className="scroll-mt-24 border-t border-line">
      <div className={`${wrap} grid grid-cols-1 gap-10 py-20 md:py-24 lg:grid-cols-[380px_minmax(0,1fr)] lg:gap-20`}>
        <div className="rv flex flex-col gap-4">
          <span className={eyebrow}>WHAT TO SEND IT</span>
          <h2 className="display m-0 text-[34px] leading-[1.05] font-bold md:text-[44px]">
            Anything a developer would pick up.
          </h2>
          <p className="m-0 text-[16px] leading-[1.6] text-ink-3">
            Each type carries its own prompt, limits and approval policy.
          </p>
        </div>
        <dl className="m-0 grid grid-cols-1 gap-x-12 sm:grid-cols-2">
          {requestTypes.map((r, i) => (
            <div
              key={r.type}
              className="rv flex flex-col gap-1.5 border-b border-line py-5.5"
              style={cssVar(i * 80)}
            >
              <dt className="mono text-[14px] font-semibold text-agent-ink">{r.type}</dt>
              <dd className="m-0 text-[15.5px] leading-[1.55] text-ink-3">{r.text}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/* ---- call to action + footer ----------------------------------------- */

function CallToAction() {
  return (
    <section id="start" className="scroll-mt-24 bg-accent text-white">
      <div className={`${wrap} flex flex-col gap-8 pt-20 pb-12 md:pt-28`}>
        <h2 className="rv display m-0 max-w-[900px] text-[44px] leading-none font-bold tracking-[-0.04em] md:text-[72px]">
          Point it at one repository first.
        </h2>
        <p className="rv m-0 max-w-[560px] text-[17px] leading-[1.55] text-white md:text-[19px]" style={cssVar(120)}>
          Start with every gate switched on. Loosen them when the record earns it.
        </p>
        <div className="rv flex flex-col gap-3 sm:flex-row" style={cssVar(240)}>
          {/* There is no self-serve sign-up yet, so the primary action here is
              signing in. Swap in a real request-access link once one exists. */}
          <Link
            href="/login"
            className="btn-lift inline-flex min-h-[56px] items-center justify-center rounded-[14px] bg-white px-7 text-[17px] font-semibold text-ink hover:text-ink"
          >
            Sign in
          </Link>
          <Link
            href="/portal"
            className="btn-lift inline-flex min-h-[56px] items-center justify-center gap-2.5 rounded-[14px] border-[1.5px] border-white px-6 text-[17px] font-semibold text-white hover:text-white"
          >
            See the control plane
            <Icon name="arrow" size={18} stroke={2} className="nudge" />
          </Link>
        </div>

        <div className="mt-16 flex flex-col gap-5 border-t border-white/70 pt-7 text-[14.5px] md:flex-row md:items-center md:gap-8">
          <span className="display text-[20px] font-bold">AgentSync</span>
          <div className="flex-1" />
          <div className="flex flex-wrap gap-x-7 gap-y-3">
            {nav.slice(0, 3).map((n) => (
              <a key={n.href} href={n.href} className="text-white hover:text-white hover:underline">
                {n.label}
              </a>
            ))}
            <Link href="/login" className="text-white hover:text-white hover:underline">
              Sign in
            </Link>
          </div>
          <span className="text-white/90">© 2026 AgentSync</span>
        </div>
      </div>
    </section>
  );
}
