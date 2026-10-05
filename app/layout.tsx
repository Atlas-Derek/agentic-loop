import type { ReactNode } from 'react';
import './globals.css';

export const metadata = { title: 'Workflow Agent', description: 'Agentic loop prototype' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
