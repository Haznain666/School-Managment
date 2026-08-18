import type { Metadata } from 'next';

import { PanelChooser } from '@/components/public/PanelChooser';
import { publicEnv } from '@/lib/env';

export const metadata: Metadata = {
  title: 'SMS Platform',
};

/**
 * Public landing page, served on the apex domain.
 *
 * ── What it used to do, and why that was not enough ──────────────────────
 * It explained that schools live on subdomains and left it there. Anyone who
 * arrived at the apex — which is what people type, and what a search engine
 * returns — reached a dead end with no way forward: no sign-in, and no route to
 * the Super Admin panel unless they already knew the `/super-admin/login` path.
 *
 * It now offers the two things that can actually be done from here: go to a
 * school's portal, or sign in as the platform operator. See
 * `components/public/PanelChooser.tsx` for why the school side asks which
 * school rather than which role.
 */
export default function LandingPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-16">
      <p className="text-sm font-semibold uppercase tracking-wide text-brand-primary">
        SMS Platform
      </p>
      <h1 className="mt-3 text-4xl font-bold tracking-tight text-ink">
        School management, built for Pakistani schools.
      </h1>
      <p className="mt-4 text-lg text-ink-muted">
        Admissions, branches, staff and students — one system per school, on your
        own subdomain.
      </p>

      <PanelChooser appDomain={publicEnv.appDomain} />
    </main>
  );
}
