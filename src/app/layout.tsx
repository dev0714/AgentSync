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

// Sets the control plane's theme before first paint, so a dark-theme reader
// never sees a flash of light: the saved choice, else the system setting.
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('agentsync-theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.setAttribute('data-theme',t)}catch(e){document.documentElement.setAttribute('data-theme','light')}})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
