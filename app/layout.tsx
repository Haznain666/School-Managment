import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

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
  /**
   * Sprint 13 — the PWA shell.
   *
   * One link for the whole app, and the manifest behind it resolves the tenant
   * from the request, so each school is a separately installable app in its own
   * name and colours. Declared here rather than in the portal layouts on
   * purpose: a parent installs from the page they are looking at, and that is
   * usually the login screen.
   */
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [{ url: '/icon/192', sizes: '192x192', type: 'image/png' }],
    apple: [{ url: '/icon/192', sizes: '192x192' }],
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
        {children}
      </body>
    </html>
  );
}
