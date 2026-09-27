import { Logo } from '@/components/site/Icon';

/** The logo in ink on the light theme and in paper on the dark one. */
export default function ThemedLogo({ size = 22 }: { size?: number }) {
  return (
    <>
      <span className="logo-on-light">
        <Logo size={size} />
      </span>
      <span className="logo-on-dark">
        <Logo size={size} tone="paper" decorative />
      </span>
    </>
  );
}
