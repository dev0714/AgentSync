import Image from 'next/image';

/**
 * Line icons for the site and the control plane — one stroke weight, drawn on
 * a 24px grid, coloured by `currentColor` so they take the text colour of
 * whatever holds them. Decorative by default; pass `label` when an icon is the
 * only thing that says what a control does.
 */

const PATHS = {
  inbox: ['M4 13h4l2 3h4l2-3h4', 'M5.5 5h13L20 13v6H4v-6z'],
  plan: ['M9 6h11', 'M9 12h11', 'M9 18h11', 'M4 6h1', 'M4 12h1', 'M4 18h1'],
  code: ['m8 8-4 4 4 4', 'm16 8 4 4-4 4', 'm14 5-4 14'],
  check: ['M4 12.5 9 17.5 20 6.5'],
  eye: ['M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
  person: ['M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M4 21c0-4 3.6-6 8-6s8 2 8 6'],
  ship: ['M7 17 17 7', 'M8 7h9v9'],
  arrow: ['M5 12h14', 'm13 6 6 6-6 6'],
  x: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'm9 9 6 6', 'm15 9-6 6'],
  lock: ['M7 11h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2z', 'M8 11V8a4 4 0 0 1 8 0v3'],
  menu: ['M4 7h16', 'M4 12h16', 'M4 17h16'],
  tasks: ['M9 6h11', 'M9 12h11', 'M9 18h11', 'm3.5 6 1 1 2-2', 'm3.5 12 1 1 2-2', 'm3.5 18 1 1 2-2'],
  approvals: ['M10 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M3 20c0-3.5 3-5.5 7-5.5', 'm15 17 2 2 4-4'],
  deploy: ['M7 17 17 7', 'M8 7h9v9'],
  audit: ['M7 3h8l4 4v14H7z', 'M15 3v4h4', 'M10 12h6', 'M10 16h6'],
  folder: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
  cpu: ['M8 6h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z', 'M9 2v4', 'M15 2v4', 'M9 18v4', 'M15 18v4', 'M2 9h4', 'M2 15h4', 'M18 9h4', 'M18 15h4'],
  plug: ['M9 2v6', 'M15 2v6', 'M6 8h12v4a6 6 0 0 1-12 0z', 'M12 18v4'],
  chart: ['M4 20V10', 'M10 20V4', 'M16 20v-7', 'M22 20H2'],
  link: ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'],
  building: ['M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16', 'M16 9h2a2 2 0 0 1 2 2v10', 'M8 7h4', 'M8 11h4', 'M8 15h4', 'M2 21h20'],
  signout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'm16 17 5-5-5-5', 'M21 12H9'],
  chevron: ['m7 10 5 5 5-5'],
  chevronRight: ['m9 6 6 6-6 6'],
  search: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'm20 20-3.5-3.5'],
  info: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 8v5', 'M12 16h.01'],
} as const;

export type IconName = keyof typeof PATHS;

export default function Icon({
  name,
  size = 20,
  stroke = 1.8,
  label,
  className,
  style,
}: {
  name: IconName;
  size?: number;
  stroke?: number;
  label?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/**
 * The AgentSync lockup — mark plus wordmark — from `public/brand/`.
 *
 * `size` is roughly the wordmark's cap height in pixels, so it lines up with
 * text set at that size. `tone="paper"` swaps the ink letters for paper on
 * dark backgrounds; the blue stays blue either way. The image says
 * "AgentSync", so pass `decorative` when a surrounding link already does.
 */
const LOGO_RATIO = 1200 / 214;

export function Logo({
  size = 24,
  tone = 'ink',
  decorative = false,
}: {
  size?: number;
  tone?: 'ink' | 'paper';
  decorative?: boolean;
}) {
  const height = Math.round(size * 1.25);
  const width = Math.round(height * LOGO_RATIO);
  // Both dimensions are pinned so a flex parent can neither squash nor
  // stretch it.
  return (
    <Image
      src={tone === 'paper' ? '/brand/agentsync-logo-paper.png' : '/brand/agentsync-logo.png'}
      alt={decorative ? '' : 'AgentSync'}
      width={width}
      height={height}
      priority
      className="block shrink-0 self-start"
      style={{ width, height, maxWidth: 'none' }}
    />
  );
}
