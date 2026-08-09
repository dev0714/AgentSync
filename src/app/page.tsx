import Link from 'next/link';
import Aurora from '@/components/Aurora';
import {
  agents,
  configGroups,
  controls,
  denies,
  integrations,
  lifecycleStates,
  phases,
  requestLines,
  requestTypes,
  responseLines,
  stateKey,
  type Line,
} from '@/data/site';

const MASK_X =
  'linear-gradient(to right, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 22%, rgba(0,0,0,1) 78%, rgba(0,0,0,0) 100%)';
const MASK_Y =
  'linear-gradient(to bottom, rgba(0,0,0,0.35) 0%, rgba(0,0,0,1) 30%, rgba(0,0,0,0.45) 66%, rgba(0,0,0,0) 96%)';

function CodeLines({ lines }: { lines: Line[] }) {
  return (
    <>
      {lines.map((l, i) => (
        <div
          key={i}
          className="mono whitespace-pre"
          style={{ fontSize: 12, lineHeight: 1.75, color: l.color }}
        >
          {l.text || ' '}
        </div>
      ))}
    </>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mono mb-3.5 text-muted-2"
      style={{ fontSize: 10, letterSpacing: '0.1em' }}
    >
      {children}
    </div>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      {/* ---- header ---- */}
      <header
        className="sticky top-0 z-20 border-b border-line-soft backdrop-blur-xl"
        style={{ background: 'rgba(10,10,11,0.86)' }}
      >
        <div className="mx-auto flex h-16 max-w-[1180px] items-center gap-3 px-8">
          <div
            className="mono flex size-[26px] items-center justify-center rounded-[7px] bg-accent font-semibold text-canvas"
            style={{ fontSize: 13 }}
          >
            A
          </div>
          <div className="text-[15px] font-semibold tracking-[-0.01em]">
            AgentSync
          </div>
          <div
            className="mono rounded border border-line px-[7px] py-0.5 text-muted-2"
            style={{ fontSize: 9.5, letterSpacing: '0.08em' }}
          >
            BY LEADSYNC
          </div>
          <div className="flex-1" />
          <nav className="flex items-center gap-5 sm:gap-[26px]">
            <div className="hidden items-center gap-[26px] lg:flex">
              {[
                ['#how', 'How it works'],
                ['#guardrails', 'Guardrails'],
                ['#config', 'Configuration'],
                ['#rollout', 'Rollout'],
              ].map(([href, label]) => (
                <a
                  key={href}
                  href={href}
                  className="text-[13.5px] text-muted no-underline hover:text-ink hover:no-underline"
                >
                  {label}
                </a>
              ))}
            </div>
            {/* Existing customers land here; the portal redirects to it anyway. */}
            <Link
              href="/login"
              className="text-[13.5px] font-medium text-muted no-underline hover:text-ink hover:no-underline"
            >
              Sign in
            </Link>
            <button className="cursor-pointer rounded-lg bg-ink px-4 py-2 text-[13px] font-semibold text-canvas hover:bg-white">
              Request access
            </button>
          </nav>
        </div>
      </header>

      {/* ---- hero ---- */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-[120px] -left-[8%] -right-[8%] h-[760px]"
          style={{ maskImage: MASK_X, WebkitMaskImage: MASK_X }}
        >
          <div
            className="size-full opacity-30 blur-[40px]"
            style={{ maskImage: MASK_Y, WebkitMaskImage: MASK_Y }}
          >
            <Aurora colorStops={['#2B2FD9', '#7C9CF5', '#F06AA8']} />
          </div>
        </div>

        <div className="relative mx-auto max-w-[1180px] px-8 pt-[88px] pb-[72px]">
          <div className="mb-7 inline-flex items-center gap-[9px] rounded-[20px] border border-line bg-card px-3 py-[5px]">
            <span className="ags-pulse size-1.5 rounded-full bg-ok-bright" />
            <span
              className="mono text-muted"
              style={{ fontSize: 10.5, letterSpacing: '0.06em' }}
            >
              MULTI-TENANT · HUMAN-GATED · AUDITED END TO END
            </span>
          </div>

          <h1
            className="mb-6 max-w-[880px] font-semibold"
            style={{
              fontSize: 60,
              lineHeight: 1.04,
              letterSpacing: '-0.035em',
              textWrap: 'pretty',
            }}
          >
            A development agent any system can call, and your reviewers still
            control.
          </h1>

          <p
            className="mb-[34px] max-w-[660px] text-[17px] text-muted"
            style={{ lineHeight: 1.6, textWrap: 'pretty' }}
          >
            Send AgentSync any development request — a feature, a bug, a
            refactor, a dependency bump, a migration, a scheduled maintenance
            job — from whatever raised it. It reads the repository, writes a
            plan, implements the change on an isolated branch, runs your own
            lint, type-check, test and build commands, and opens a pull request.
            Every project decides which gates a human has to pass before
            anything merges or deploys.
          </p>

          <div className="mb-14 flex flex-wrap gap-3">
            <button className="cursor-pointer rounded-[9px] bg-ink px-[22px] py-3 text-sm font-semibold text-canvas hover:bg-white">
              Request access
            </button>
            <Link
              href="/portal"
              className="rounded-[9px] border border-[#2A2A2F] bg-card px-[22px] py-3 text-sm font-medium text-ink no-underline hover:border-[#3A3A40] hover:text-ink hover:no-underline"
            >
              See the control plane
            </Link>
          </div>

          <div className="overflow-hidden rounded-xl border border-line bg-surface">
            <div
              className="flex items-center gap-2 border-b border-line-soft px-4 py-[11px]"
              style={{ background: '#111113' }}
            >
              <span className="size-[9px] rounded-full bg-[#2A2A2F]" />
              <span className="size-[9px] rounded-full bg-[#2A2A2F]" />
              <span className="size-[9px] rounded-full bg-[#2A2A2F]" />
              <span
                className="mono ml-2 text-muted-3"
                style={{ fontSize: 10.5 }}
              >
                POST /api/v1/agent/tasks
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2">
              <div className="border-b border-line-soft px-6 py-[22px] md:border-r md:border-b-0">
                <CodeLines lines={requestLines} />
              </div>
              <div className="px-6 py-[22px]">
                <div
                  className="mono mb-3.5 text-muted-3"
                  style={{ fontSize: 9.5, letterSpacing: '0.08em' }}
                >
                  18 MINUTES LATER
                </div>
                <CodeLines lines={responseLines} />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---- how it works ---- */}
      <section id="how" className="border-t border-line-soft bg-canvas-alt">
        <div className="mx-auto max-w-[1180px] px-8 py-[72px]">
          <Eyebrow>HOW IT WORKS</Eyebrow>
          <h2
            className="mb-3.5 max-w-[640px] text-[34px] font-semibold"
            style={{ letterSpacing: '-0.025em', textWrap: 'pretty' }}
          >
            Five specialised agents, not one that does everything.
          </h2>
          <p
            className="mb-11 max-w-[620px] text-[15px] text-muted"
            style={{ lineHeight: 1.6 }}
          >
            Each stage has a narrow job and a defined output. The orchestrator
            owns task state, enforces limits, and refuses to let a later stage
            run when an earlier one failed.
          </p>

          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-5">
            {agents.map((a) => (
              <div
                key={a.n}
                className="flex flex-col gap-[11px] rounded-[11px] border border-line bg-card px-[18px] py-5"
              >
                <div
                  className="mono text-accent"
                  style={{ fontSize: 10, letterSpacing: '0.06em' }}
                >
                  {a.n}
                </div>
                <div className="text-[15px] font-semibold tracking-[-0.01em]">
                  {a.name}
                </div>
                <div
                  className="text-[13px] text-muted"
                  style={{ lineHeight: 1.55 }}
                >
                  {a.text}
                </div>
                <div
                  className="mono mt-auto border-t border-line-faint pt-2.5 text-muted-3"
                  style={{ fontSize: 10 }}
                >
                  {a.out}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-11 rounded-xl border border-line bg-card px-7 py-[26px]">
            <div
              className="mono mb-[22px] text-muted-2"
              style={{ fontSize: 9.5, letterSpacing: '0.08em' }}
            >
              TASK LIFECYCLE · EVERY TRANSITION WRITTEN TO AN APPEND-ONLY LOG
            </div>
            <div className="flex flex-wrap gap-2">
              {lifecycleStates.map((st) => (
                <div
                  key={st.name}
                  className="mono rounded-md border px-[11px] py-[5px]"
                  style={{
                    fontSize: 11,
                    background: st.bg,
                    color: st.fg,
                    borderColor: st.border,
                  }}
                >
                  {st.name}
                </div>
              ))}
            </div>
            <div className="mt-5 flex flex-wrap gap-[22px] border-t border-line-faint pt-[18px]">
              {stateKey.map((k) => (
                <div key={k.label} className="flex items-center gap-2">
                  <span
                    className="size-2 rounded-[2px]"
                    style={{ background: k.color }}
                  />
                  <span className="text-xs text-muted">{k.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ---- guardrails ---- */}
      <section id="guardrails" className="border-t border-line-soft">
        <div className="mx-auto max-w-[1180px] px-8 py-[72px]">
          <div className="grid grid-cols-1 items-start gap-16 lg:grid-cols-2">
            <div>
              <Eyebrow>GUARDRAILS</Eyebrow>
              <h2
                className="mb-4 text-[34px] font-semibold"
                style={{ letterSpacing: '-0.025em', textWrap: 'pretty' }}
              >
                The agent works inside a box you draw.
              </h2>
              <p
                className="mb-7 text-[15px] text-muted"
                style={{ lineHeight: 1.65, textWrap: 'pretty' }}
              >
                Repository files, ticket text and pull-request comments are all
                treated as untrusted input. Instructions found inside them are
                logged and ignored, never executed. Commands run in a sandboxed
                workspace with no network egress, and that workspace is
                destroyed when the task ends.
              </p>
              <div className="flex flex-col gap-0.5">
                {denies.map((d) => (
                  <div
                    key={d}
                    className="flex items-baseline gap-3 border-b border-line-soft py-[11px]"
                  >
                    <span
                      className="mono shrink-0 basis-[46px] text-danger"
                      style={{ fontSize: 10 }}
                    >
                      DENIED
                    </span>
                    <span
                      className="text-[13.5px] text-ink-3"
                      style={{ lineHeight: 1.5 }}
                    >
                      {d}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-3.5">
              {controls.map((c) => (
                <div
                  key={c.title}
                  className="rounded-[11px] border border-line bg-card px-[22px] py-5"
                >
                  <div className="mb-2 text-[14.5px] font-semibold">
                    {c.title}
                  </div>
                  <div
                    className="mb-3.5 text-[13.5px] text-muted"
                    style={{ lineHeight: 1.6 }}
                  >
                    {c.text}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {c.tags.map((t) => (
                      <span
                        key={t}
                        className="mono rounded-[5px] border border-line bg-raised px-[9px] py-[3px] text-muted"
                        style={{ fontSize: 10 }}
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ---- configuration ---- */}
      <section id="config" className="border-t border-line-soft bg-canvas-alt">
        <div className="mx-auto max-w-[1180px] px-8 py-[72px]">
          <Eyebrow>CONFIGURATION</Eyebrow>
          <h2
            className="mb-3.5 max-w-[700px] text-[34px] font-semibold"
            style={{ letterSpacing: '-0.025em', textWrap: 'pretty' }}
          >
            No customer name appears anywhere in the source.
          </h2>
          <p
            className="mb-10 max-w-[640px] text-[15px] text-muted"
            style={{ lineHeight: 1.6 }}
          >
            Repositories, branches, build commands, path allowlists, change
            limits, prompts, model routing, cost caps and approval policy all
            live in Supabase, scoped per project and isolated per tenant by
            row-level security. Onboarding a new customer, a new stack, or a new
            kind of request is configuration, not a release.
          </p>

          <div className="mb-3.5 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
            {configGroups.map((g) => (
              <div
                key={g.title}
                className="overflow-hidden rounded-[11px] border border-line bg-card"
              >
                <div className="border-b border-line-faint bg-raised px-4 py-[13px]">
                  <div className="text-[13.5px] font-semibold">{g.title}</div>
                  <div
                    className="mono mt-[3px] text-muted-3"
                    style={{ fontSize: 9.5 }}
                  >
                    {g.table}
                  </div>
                </div>
                <div className="px-4 pt-1.5 pb-3.5">
                  {g.keys.map((k) => (
                    <div
                      key={k}
                      className="mono border-b border-[#17171A] py-1.5 text-muted"
                      style={{ fontSize: 11 }}
                    >
                      {k}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mb-3.5 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            {requestTypes.map((rt) => (
              <div
                key={rt.type}
                className="rounded-[11px] border border-line bg-card px-5 py-[18px]"
              >
                <div
                  className="mono mb-[7px] text-accent"
                  style={{ fontSize: 10.5 }}
                >
                  {rt.type}
                </div>
                <div
                  className="text-[12.5px] text-muted"
                  style={{ lineHeight: 1.5 }}
                >
                  {rt.text}
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            {integrations.map((i) => (
              <div
                key={i.name}
                className="flex items-start gap-[13px] rounded-[11px] border border-line bg-card px-5 py-[18px]"
              >
                <span
                  className="mt-1.5 size-[7px] shrink-0 rounded-full"
                  style={{ background: i.dot }}
                />
                <div>
                  <div className="mb-1 text-sm font-semibold">{i.name}</div>
                  <div
                    className="text-[12.5px] text-muted"
                    style={{ lineHeight: 1.5 }}
                  >
                    {i.text}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- rollout ---- */}
      <section id="rollout" className="border-t border-line-soft">
        <div className="mx-auto max-w-[1180px] px-8 py-[72px]">
          <Eyebrow>ROLLOUT</Eyebrow>
          <h2
            className="mb-10 max-w-[640px] text-[34px] font-semibold"
            style={{ letterSpacing: '-0.025em', textWrap: 'pretty' }}
          >
            Six phases, each one shippable on its own.
          </h2>
          <div className="flex flex-col">
            {phases.map((p) => (
              <div
                key={p.n}
                className="grid grid-cols-[48px_1fr] items-baseline gap-x-6 gap-y-2 border-b border-line-soft py-5 lg:grid-cols-[64px_260px_1fr_110px]"
              >
                <div className="mono text-accent" style={{ fontSize: 11 }}>
                  {p.n}
                </div>
                <div className="text-base font-semibold tracking-[-0.015em]">
                  {p.name}
                </div>
                <div
                  className="col-span-2 text-[13.5px] text-muted lg:col-span-1"
                  style={{ lineHeight: 1.55 }}
                >
                  {p.text}
                </div>
                <div
                  className="mono col-start-2 w-fit rounded-[5px] px-[9px] py-[3px] text-center lg:col-start-4 lg:w-auto"
                  style={{ fontSize: 10, background: p.bg, color: p.fg }}
                >
                  {p.state}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- closing ---- */}
      <section className="border-t border-line-soft bg-canvas-alt">
        <div className="mx-auto flex max-w-[1180px] flex-col items-start gap-12 px-8 py-[72px] lg:flex-row lg:items-center">
          <div className="flex-1">
            <div
              className="mb-3 text-[30px] font-semibold"
              style={{ letterSpacing: '-0.025em', textWrap: 'pretty' }}
            >
              Point it at one repository and one ticket queue.
            </div>
            <div
              className="max-w-[560px] text-[15px] text-muted"
              style={{ lineHeight: 1.6 }}
            >
              Start with one request type, plan approval and merge approval both
              on. Add types and loosen gates per project once you have watched
              it work.
            </div>
          </div>
          <div className="flex gap-3">
            <button className="cursor-pointer rounded-[9px] bg-ink px-[22px] py-3 text-sm font-semibold text-canvas hover:bg-white">
              Request access
            </button>
            <button className="cursor-pointer rounded-[9px] border border-[#2A2A2F] bg-card px-[22px] py-3 text-sm font-medium text-ink hover:border-[#3A3A40]">
              Read the brief
            </button>
          </div>
        </div>
      </section>

      <footer className="border-t border-line-soft">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-6 px-8 py-8">
          <div
            className="mono text-muted-3"
            style={{ fontSize: 10.5, letterSpacing: '0.06em' }}
          >
            AGENTSYNC · A LEADSYNC PLATFORM
          </div>
          <div className="flex-1" />
          {['Status', 'Security', 'Docs'].map((l) => (
            <div key={l} className="cursor-pointer text-[13px] text-muted">
              {l}
            </div>
          ))}
        </div>
      </footer>
    </div>
  );
}
