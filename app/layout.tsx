import type { ReactNode } from 'react';
import { THEME_INIT_SCRIPT } from '@/lib/theme';
import './globals.css';

export const metadata = { title: 'Workflow Agent', description: 'Agentic loop prototype' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The inline script swaps data-theme before paint; suppressHydrationWarning lets React keep that change.
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
