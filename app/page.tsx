import type { Metadata } from 'next';
import Image from 'next/image';

import { CentralSignIn } from '@/components/public/CentralSignIn';

export const metadata: Metadata = {
  title: 'SchoolHub — sign in',
};

/**
 * The apex: one sign-in for everybody. Sprint 35, §7 and §8.
 *
 * ── What it used to be ───────────────────────────────────────────────────
 * A landing page with a `PanelChooser` — "go to your school" or "sign in as the
 * platform operator" — which asked a parent to know their school's subdomain
 * and asked the operator to know a path. It is gone. There is one form: a Login
 * ID and a password, and the server works out who that is and where they go
 * (`app/api/platform/sign-in/route.ts`).
 *
 * ── Still prerendered, deliberately ──────────────────────────────────────
 * No `searchParams`, no `cookies()`, no `headers()`, no database read — the
 * four things CLAUDE.md lists as turning a page dynamic by accident. The form
 * is a client component and does its work through an API route, so this page
 * is built once and served from the CDN's edge (~85ms) rather than the origin
 * (~1s), which is the whole difference on a parent's phone.
 *
 * ── The bot ──────────────────────────────────────────────────────────────
 * On the sign-in page only, and quiet: small, off to the side, faded, and not
 * drawn at all below `md` — on a phone the form is the page, and nothing may
 * compete with it (§8).
 */
export default function LandingPage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-surface-sunken px-4 py-12">
      <Image
        src="/brand/schoolhub-bot.png"
        alt=""
        aria-hidden="true"
        width={561}
        height={987}
        className="pointer-events-none absolute bottom-0 right-[6%] hidden h-auto w-40 select-none opacity-25 md:block lg:w-48"
      />

      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Image
            src="/brand/schoolhub-logo.png"
            alt="SchoolHub"
            width={1774}
            height={319}
            priority
            className="h-10 w-auto"
          />
          <p className="mt-4 text-sm text-ink-muted">
            Sign in to your school, or to the platform.
          </p>
        </div>

        <div className="rounded-card border border-line bg-surface-raised p-6 shadow-card">
          <CentralSignIn />
        </div>

        <p className="mt-6 text-center text-xs text-ink-muted">
          Each school&apos;s own address still has its own sign-in page.
        </p>
      </div>
    </main>
  );
}
