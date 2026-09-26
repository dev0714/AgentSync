import type { Metadata } from 'next';
import { Bricolage_Grotesque, Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

// Display face for headings, a quiet sans for reading, a mono for code and
// identifiers. Three faces, each with one job.
const display = Bricolage_Grotesque({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-display-face',
});

const sans = Geist({
  subsets: ['latin'],
  variable: '--font-sans-face',
});

const mono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-mono-face',
});

export const metadata: Metadata = {
  title: 'AgentSync — requests in, reviewed pull requests out',
  description:
    'A development agent any system can call. It plans, builds and checks the change on an isolated branch — and nothing merges or deploys until the people you choose approve it.',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${mono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
