import type { ReactNode } from 'react';
import { LAYOUT_INIT_SCRIPT } from '@/lib/layout';
import { THEME_INIT_SCRIPT } from '@/lib/theme';
import './globals.css';

export const metadata = { title: 'Workflow Agent', description: 'Agentic loop prototype' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The inline scripts set data-theme and saved panel widths before paint;
    // suppressHydrationWarning lets React keep those changes to <html>.
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: LAYOUT_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
