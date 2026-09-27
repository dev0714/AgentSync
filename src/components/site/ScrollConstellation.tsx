'use client';

import { useEffect, useRef } from 'react';

/**
 * The homepage background: a faint code map behind the page that lights up
 * blue as you read down it, drifting a little slower than the content.
 *
 * One fixed <canvas> behind everything; nodes live in page coordinates so the
 * map spans the whole document. It lives only in the side margins, and lines
 * never cross from one side to the other, so nothing is drawn behind the text. Reduced motion keeps the lighting (it follows the scroll, it does not
 * move on its own) but drops the drift and the pulse.
 */

const PARALLAX = 0.3; // how much slower than the page the map moves
const REACH = 0.7; // how far down the viewport counts as "read"
const FADE = 140; // px over which a node turns from grey to blue

type Node = { x: number; y: number; r: number; hub: boolean };

function makeMap(width: number, height: number) {
  let s = 11;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  const count = Math.round(height / (width < 768 ? 90 : 46));
  const margin = width < 768 ? 24 : Math.max(60, (width - 1200) / 2 + 30);
  const nodes: Node[] = [];
  for (let i = 0; i < count; i++) {
    const x = rnd() < 0.5 ? rnd() * margin : width - rnd() * margin;
    const hub = rnd() < 0.12;
    nodes.push({ x, y: 40 + (i / count) * (height - 80) + rnd() * 50, r: hub ? 6 : 2 + rnd() * 3, hub });
  }
  const edges: [number, number][] = [];
  nodes.forEach((a, i) => {
    nodes
      .map((b, j) => ({ j, d: Math.hypot(a.x - b.x, a.y - b.y) }))
      .filter((o) => o.j > i && o.d < 400 && nodes[o.j].x < width / 2 === a.x < width / 2)
      .sort((p, q) => p.d - q.d)
      .slice(0, a.hub ? 4 : 2)
      .forEach((o) => edges.push([i, o.j]));
  });
  return { nodes, edges };
}

/** 0 (grey) → 1 (blue) as the reading line passes a point. */
const lit = (y: number, reach: number) => Math.max(0, Math.min(1, (reach - y) / FADE));

const mix = (a: number[], b: number[], t: number, alpha: number) =>
  `rgba(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')},${alpha})`;
const GREY = [190, 183, 168];
const BLUE = [11, 107, 255];

export default function ScrollConstellation() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const k = reduce ? 0 : PARALLAX;
    let map = makeMap(window.innerWidth, document.documentElement.scrollHeight);
    let frame = 0;
    let dirty = true;

    const size = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      map = makeMap(window.innerWidth, document.documentElement.scrollHeight);
      dirty = true;
    };

    const draw = (now: number) => {
      const vh = window.innerHeight;
      const scroll = window.scrollY;
      const shift = scroll * k; // the map trails the page by this much
      const toScreen = (y: number) => y - scroll + shift;
      const reach = scroll + vh * REACH - shift;
      ctx.clearRect(0, 0, window.innerWidth, vh);

      const visible = (y: number) => {
        const sy = toScreen(y);
        return sy > -420 && sy < vh + 420;
      };

      ctx.lineCap = 'round';
      for (const [i, j] of map.edges) {
        const a = map.nodes[i];
        const b = map.nodes[j];
        if (!visible(a.y) && !visible(b.y)) continue;
        const t = Math.min(lit(a.y, reach), lit(b.y, reach));
        ctx.strokeStyle = mix(GREY, BLUE, t, 0.3 + 0.18 * t);
        ctx.lineWidth = 1 + 0.5 * t;
        ctx.beginPath();
        ctx.moveTo(a.x, toScreen(a.y));
        ctx.lineTo(b.x, toScreen(b.y));
        ctx.stroke();
      }

      let front: Node | null = null;
      for (const n of map.nodes) {
        if (!visible(n.y)) continue;
        const t = lit(n.y, reach);
        const sy = toScreen(n.y);
        if (n.hub && t > 0) {
          ctx.fillStyle = `rgba(11,107,255,${0.16 * t})`;
          ctx.beginPath();
          ctx.arc(n.x, sy, n.r + 5, 0, Math.PI * 2);
          ctx.fill();
          if (t >= 1 && (!front || n.y > front.y)) front = n;
        }
        ctx.fillStyle = mix(GREY, BLUE, t, 0.55 + 0.45 * t);
        ctx.beginPath();
        ctx.arc(n.x, sy, n.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // The newest hub the reading line has passed pulses, like the request arriving.
      if (front && !reduce) {
        const p = (now % 1600) / 1600;
        ctx.strokeStyle = `rgba(11,107,255,${0.8 * (1 - p)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(front.x, toScreen(front.y), front.r * (1 + 2.2 * p), 0, Math.PI * 2);
        ctx.stroke();
      }
    };

    const loop = (now: number) => {
      if (!reduce || dirty) {
        draw(now);
        dirty = false;
      }
      frame = requestAnimationFrame(loop);
    };

    const onScroll = () => {
      dirty = true;
    };
    // The document grows as fonts and images load; re-lay the map when it does.
    const ro = new ResizeObserver(size);
    ro.observe(document.body);
    window.addEventListener('scroll', onScroll, { passive: true });
    size();
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  return <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 z-0 h-screen w-screen" />;
}
