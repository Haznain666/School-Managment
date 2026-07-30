import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { AuthProvider } from '@/components/auth/AuthProvider';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'SMS Platform',
    template: '%s · SMS Platform',
  },
  description: 'School management, built for Pakistani schools.',
  robots: {
    // Tenant portals must never be indexed.
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans">
        {/* Auth state is needed by both the login page and every portal. */}
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
