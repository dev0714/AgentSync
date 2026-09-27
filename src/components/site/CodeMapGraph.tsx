'use client';

import { useEffect, useMemo, useState } from 'react';

/**
 * An illustrative code map for the homepage: six named parts of an example
 * codebase, and what a change to one function reaches.
 *
 * In "Impact of a change" the effect ripples outward a ring at a time — the
 * changed function, then its direct callers, then theirs — with a flow along
 * each edge it travels, then holds and repeats. The layout is generated from a
 * fixed seed so server and browser draw the same graph. Reduced motion (and
 * the server render) shows the ripple complete.
 */

const W = 820;
const H = 540;
const WAVE_MS = 700;
const CYCLE = 12; // waves per loop: 4 to spread, the rest to hold

const CLUSTERS = [
  { key: 'tickets', label: 'Tickets', x: 170, y: 150, c: '#4C8DFF', n: 11 },
  { key: 'invoices', label: 'Invoices & billing', x: 430, y: 250, c: '#F08A4B', n: 12 },
  { key: 'clients', label: 'Clients', x: 660, y: 130, c: '#7FD1A2', n: 9 },
  { key: 'auth', label: 'Auth & users', x: 150, y: 400, c: '#C9A7FF', n: 8 },
  { key: 'email', label: 'Email', x: 660, y: 410, c: '#F2CF5B', n: 8 },
  { key: 'hooks', label: 'Webhooks', x: 400, y: 460, c: '#5FD4E0', n: 6 },
] as const;

type Node = { x: number; y: number; r: number; ci: number; hub: boolean };

function build() {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const nodes: Node[] = [];
  const edges: [number, number][] = [];
  CLUSTERS.forEach((cl, ci) => {
    const hub = nodes.length;
    nodes.push({ x: cl.x, y: cl.y, r: 9, ci, hub: true });
    for (let i = 1; i < cl.n; i++) {
      const a = rnd() * Math.PI * 2;
      const d = 38 + rnd() * 62;
      nodes.push({ x: cl.x + Math.cos(a) * d * 1.25, y: cl.y + Math.sin(a) * d, r: 3 + rnd() * 3, ci, hub: false });
      edges.push([rnd() < 0.7 ? hub : hub + 1 + Math.floor(rnd() * Math.max(1, i - 1)), nodes.length - 1]);
    }
  });
  const hubOf = (k: string) => nodes.findIndex((n) => n.hub && CLUSTERS[n.ci].key === k);
  const links: [string, string][] = [
    ['tickets', 'invoices'], ['tickets', 'clients'], ['invoices', 'clients'], ['auth', 'tickets'], ['invoices', 'email'],
    ['email', 'clients'], ['hooks', 'invoices'], ['hooks', 'tickets'], ['auth', 'clients'],
  ];
  links.forEach(([a, b]) => edges.push([hubOf(a), hubOf(b)]));
  for (let i = 0; i < 8; i++) edges.push([Math.floor(rnd() * nodes.length), Math.floor(rnd() * nodes.length)]);

  // The change, and how many hops each thing it reaches is from it.
  const inv = hubOf('invoices');
  const changed = inv + 3;
  nodes[changed].r = 8;
  const depth = new Map<number, number>([
    [changed, 0], [inv, 1], [inv + 5, 1], [inv + 7, 2], [hubOf('tickets'), 2], [hubOf('email'), 2], [hubOf('hooks'), 3],
  ]);
  // Only connections one hop apart carry the ripple; point them away from the change.
  const ripple = edges
    .filter(([a, b]) => depth.has(a) && depth.has(b) && Math.abs(depth.get(a)! - depth.get(b)!) === 1)
    .map(([a, b]) => (depth.get(a)! > depth.get(b)! ? [b, a] : [a, b]) as [number, number]);
  // Guarantee every reached part has a visible path back to the change.
  const linked = new Set(ripple.map(([, b]) => b));
  for (const [n, d] of depth) {
    if (d === 0 || linked.has(n)) continue;
    const parent = [...depth].find(([, pd]) => pd === d - 1)![0];
    ripple.push([n === inv + 7 ? inv : parent, n]);
  }
  const labels = [
    { node: changed, text: 'calculateTotals — the change', dx: 0, dy: -24, tone: 'agent' },
    { node: inv, text: 'BillingService · hub', dx: 18, dy: 30, tone: 'gate' },
    { node: hubOf('tickets'), text: 'TicketController.close', dx: 0, dy: -22, tone: 'gate' },
    { node: hubOf('email'), text: 'InvoiceMailer', dx: 0, dy: -22, tone: 'gate' },
    { node: hubOf('hooks'), text: 'onMerge', dx: 0, dy: 30, tone: 'gate' },
  ];
  return { nodes, edges, ripple, depth, changed, labels };
}

export default function CodeMapGraph() {
  const g = useMemo(build, []);
  const [view, setView] = useState<'impact' | 'clusters'>('impact');
  const [wave, setWave] = useState(CYCLE - 1);

  useEffect(() => {
    if (view !== 'impact' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setWave(0);
    const id = setInterval(() => setWave((w) => (w + 1) % CYCLE), WAVE_MS);
    return () => clearInterval(id);
  }, [view]);

  const impact = view === 'impact';
  const reached = (i: number) => g.depth.has(i) && g.depth.get(i)! < wave;
  const callers = [...g.depth.keys()].filter((i) => i !== g.changed);
  const count = callers.filter(reached).length;

  return (
    <figure className="m-0 flex min-w-0 flex-col overflow-hidden rounded-[24px] border border-night-line bg-night-2">
      <div className="flex flex-wrap items-center gap-3 border-b border-night-line px-5 py-3.5">
        <span className="mono text-[13px] text-[#c9c6bd]">example-app / code map</span>
        <span className="mono hidden text-[12px] text-[#8e9098] sm:inline">
          {g.nodes.length} nodes · {CLUSTERS.length} parts
        </span>
        <div className="flex-1" />
        <div role="group" aria-label="Graph view" className="flex gap-0.5 rounded-lg border border-night-line bg-night p-[3px]">
          {(['clusters', 'impact'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={`h-8 cursor-pointer rounded-[6px] px-3 text-[13px] font-medium transition-colors ${
                view === v ? 'bg-night-line text-canvas' : 'text-[#a7a49b] hover:text-canvas'
              }`}
            >
              {v === 'clusters' ? 'Parts' : 'Impact of a change'}
            </button>
          ))}
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={
          impact
            ? 'Example code map with a change to calculateTotals and the six places it reaches highlighted.'
            : 'Example code map grouped into six parts: tickets, invoices and billing, clients, auth and users, email, and webhooks.'
        }
        className="block h-auto w-full"
      >
        <defs>
          {CLUSTERS.map((cl) => (
            <radialGradient key={cl.key} id={`halo-${cl.key}`}>
              <stop offset="0" stopColor={cl.c} stopOpacity="0.28" />
              <stop offset="1" stopColor={cl.c} stopOpacity="0" />
            </radialGradient>
          ))}
        </defs>

        {CLUSTERS.map((cl, i) => (
          <circle
            key={cl.key}
            cx={cl.x}
            cy={cl.y}
            r={125}
            fill={`url(#halo-${cl.key})`}
            className="map-breathe"
            style={{ opacity: impact ? 0.3 : 1, transition: 'opacity 500ms', animationDelay: `${-i}s`, transformOrigin: `${cl.x}px ${cl.y}px` }}
          />
        ))}

        {g.edges.map(([a, b], i) =>
          a === b ? null : (
            <line
              key={i}
              x1={g.nodes[a].x}
              y1={g.nodes[a].y}
              x2={g.nodes[b].x}
              y2={g.nodes[b].y}
              stroke={g.nodes[a].ci !== g.nodes[b].ci ? '#b4b7bf' : '#9a9da6'}
              strokeOpacity={impact ? 0.12 : 0.28}
              strokeWidth={1}
              style={{ transition: 'stroke-opacity 400ms' }}
            />
          ),
        )}

        {impact
          ? g.ripple.map(([a, b], i) =>
              reached(a) && reached(b) ? (
                <line
                  key={`r${i}`}
                  x1={g.nodes[a].x}
                  y1={g.nodes[a].y}
                  x2={g.nodes[b].x}
                  y2={g.nodes[b].y}
                  stroke="#F08A4B"
                  strokeWidth={2}
                  strokeDasharray="6 8"
                  strokeLinecap="round"
                  className="map-flow"
                />
              ) : null,
            )
          : null}

        {g.nodes.map((n, i) => {
          const cl = CLUSTERS[n.ci];
          const isChange = i === g.changed;
          const on = reached(i);
          const fill = !impact ? cl.c : isChange ? '#4C8DFF' : on ? '#F08A4B' : '#4a4d57';
          return (
            <g key={i}>
              {impact && isChange ? (
                <circle cx={n.x} cy={n.y} r={n.r} fill="none" stroke="#4C8DFF" strokeWidth={2} className="map-ping" style={{ transformOrigin: `${n.x}px ${n.y}px` }} />
              ) : null}
              {impact && on && !isChange ? (
                <circle cx={n.x} cy={n.y} r={n.r + 4} fill="#F08A4B" fillOpacity={0.25} />
              ) : null}
              <circle cx={n.x} cy={n.y} r={n.r} fill={fill} style={{ transition: 'fill 400ms' }}>
                <title>{n.hub ? cl.label : `${cl.label}: function`}</title>
              </circle>
            </g>
          );
        })}

        {impact
          ? g.labels.map((l) => {
              const n = g.nodes[l.node];
              const visible = l.node === g.changed || reached(l.node);
              const w = l.text.length * 7.4 + 16;
              return (
                <g
                  key={l.text}
                  transform={`translate(${n.x + l.dx} ${n.y + l.dy})`}
                  style={{ opacity: visible ? 1 : 0, transition: 'opacity 400ms' }}
                >
                  <rect x={-w / 2} y={-11} width={w} height={22} rx={6} fill="#15161a" fillOpacity={0.9} />
                  <text
                    textAnchor="middle"
                    dy="4"
                    className="mono"
                    fontSize="12.5"
                    fontWeight="600"
                    fill={l.tone === 'agent' ? '#8db5ff' : '#f7ad7e'}
                  >
                    {l.text}
                  </text>
                </g>
              );
            })
          : CLUSTERS.map((cl) => (
              <text key={cl.key} x={cl.x} y={cl.y - 108} textAnchor="middle" className="mono" fontSize="13" fontWeight="500" fill={cl.c}>
                {cl.label}
              </text>
            ))}
      </svg>

      <figcaption className="flex flex-wrap gap-x-5 gap-y-2 border-t border-night-line px-5 py-3.5 text-[13px] text-[#c9c6bd]">
        {impact ? (
          <>
            <Key c="#4C8DFF">The code the request is about</Key>
            <Key c="#F08A4B">
              <span aria-live="polite">
                What the change reaches ({count} of {callers.length})
              </span>
            </Key>
            <Key c="#4a4d57">Untouched</Key>
          </>
        ) : (
          CLUSTERS.map((cl) => (
            <Key key={cl.key} c={cl.c}>
              {cl.label}
            </Key>
          ))
        )}
      </figcaption>
    </figure>
  );
}

function Key({ c, children }: { c: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      <span className="size-2.5 rounded-full" style={{ background: c }} />
      {children}
    </span>
  );
}
