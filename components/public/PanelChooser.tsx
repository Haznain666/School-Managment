'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { slugify } from '@/lib/slug';
import { cn } from '@/lib/utils';

/**
 * "Which panel do you want?", on the apex domain.
 *
 * ── The thing this screen has to be honest about ─────────────────────────
 * There are not eleven sign-in panels. Every school role — administrator,
 * principal, teacher, accountant, student, parent — signs in at the *same*
 * `/login`, on their own school's subdomain, with the same email and password.
 * Which panel they land on is decided by their `school_users` row, not by
 * anything they choose here: `ROLE_HOME_ROUTES` sends a teacher to `/teacher`
 * and a parent to `/parent` the moment the session is minted.
 *
 * So offering eleven buttons that all lead to one form would be a menu of
 * decisions that do not exist, and the first person to pick "Teacher" and land
 * somewhere labelled differently would reasonably think it was broken. The
 * roles are *listed* — so a visitor can see their own panel named and know they
 * are in the right place — and the one question that genuinely has to be
 * answered is asked instead: **which school**.
 *
 * That question is unavoidable. Credentials are per-tenant, resolved from the
 * hostname by middleware, so a school user cannot sign in on the apex at all.
 * Super Admin is the exception and is the other half of this screen: the
 * platform operator has no tenant, so their sign-in lives here.
 *
 * ── Why the school is typed rather than picked from a list ───────────────
 * A dropdown of every school on the platform would be a tenant directory served
 * to anyone who loads the front page — the customer list, free. Typing a
 * subdomain discloses nothing: a wrong guess lands on `/school-not-found`,
 * which is exactly what a wrong guess at any URL already does.
 */

export interface PanelChooserProps {
  /** Apex the school subdomains hang off, e.g. `schoolhub.codexmill.com`. */
  appDomain: string;
}

/** What the school portal covers, for a visitor looking for their own name. */
const SCHOOL_PANELS: readonly string[] = [
  'School Administrator',
  'Principal & Vice Principal',
  'Coordinator',
  'Teacher',
  'Student',
  'Parent',
  'Accountant',
  'HR Manager',
];

type Choice = null | 'school';

export function PanelChooser({ appDomain }: PanelChooserProps) {
  const router = useRouter();
  const [choice, setChoice] = useState<Choice>(null);
  const [slug, setSlug] = useState('');
  const [error, setError] = useState<string | null>(null);

  const goToSchool = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const cleaned = slugify(slug.trim());
      if (cleaned === '') {
        setError('Enter your school’s address — the part before the dot.');
        return;
      }

      /**
       * Two ways to reach a tenant, and which one applies is a property of the
       * host rather than a preference.
       *
       * On the real platform domain a school *is* a subdomain, so the browser
       * has to travel to a different origin. Anywhere else — localhost, a bare
       * deployment host — there are no subdomains, and middleware falls back to
       * `?school=`. Sending a localhost visitor to `beaconhouse.localhost:3000`
       * would resolve to nothing at all.
       *
       * This mirrors `buildHandoffUrl` in `lib/platform-school-access.ts`,
       * which makes the same decision for the operator hand-off.
       */
      const host = window.location.hostname.toLowerCase();
      const apex = appDomain.toLowerCase().trim();
      const onPlatformHost =
        apex !== '' && (host === apex || host.endsWith(`.${apex}`));

      if (onPlatformHost) {
        const port = window.location.port === '' ? '' : `:${window.location.port}`;
        window.location.href = `${window.location.protocol}//${cleaned}.${apex}${port}/login`;
        return;
      }

      router.push(`/login?school=${encodeURIComponent(cleaned)}`);
    },
    [slug, appDomain, router],
  );

  return (
    <div className="mt-10 grid gap-4 sm:grid-cols-2">
      {/* ── The school portal ── */}
      <section
        className={cn(
          'rounded-card border bg-surface-raised p-6 transition',
          choice === 'school' ? 'border-brand-primary' : 'border-line',
        )}
      >
        <h2 className="text-base font-semibold text-ink">School portal</h2>
        <p className="mt-2 text-sm text-ink-muted">
          For everyone at a school. You are taken to your own panel automatically
          once you sign in — there is nothing to choose here.
        </p>

        <ul className="mt-3 flex flex-wrap gap-1.5">
          {SCHOOL_PANELS.map((panel) => (
            <li
              key={panel}
              className="rounded-full bg-surface-sunken px-2.5 py-1 text-xs text-ink-muted"
            >
              {panel}
            </li>
          ))}
        </ul>

        {choice === 'school' ? (
          <form onSubmit={goToSchool} className="mt-5 space-y-3" noValidate>
            <Input
              label="Your school’s address"
              value={slug}
              onChange={(event) => {
                setSlug(event.target.value.toLowerCase());
                setError(null);
              }}
              error={error ?? undefined}
              hint={
                error === null
                  ? `We will take you to ${slug.trim() === '' ? 'yourschool' : slugify(slug.trim())}.${appDomain}`
                  : undefined
              }
              placeholder="beaconhouse"
              autoFocus
              autoComplete="organization"
            />
            <div className="flex gap-2">
              <Button type="submit" size="sm">
                Continue
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setChoice(null);
                  setError(null);
                }}
              >
                Back
              </Button>
            </div>
            <p className="text-xs text-ink-muted">
              Not sure? It is in the link your school sent you, or ask your school
              administrator.
            </p>
          </form>
        ) : (
          <Button
            className="mt-5"
            size="sm"
            onClick={() => {
              setChoice('school');
            }}
          >
            Go to my school
          </Button>
        )}
      </section>

      {/* ── The platform operator ── */}
      <section className="rounded-card border border-line bg-surface-raised p-6">
        <h2 className="text-base font-semibold text-ink">Super Admin</h2>
        <p className="mt-2 text-sm text-ink-muted">
          Platform administration — schools, branches, modules and billing across
          every tenant. This is the one panel that does not belong to a school,
          which is why it signs in here rather than on a subdomain.
        </p>

        <Button
          className="mt-5"
          size="sm"
          variant="secondary"
          onClick={() => {
            router.push('/super-admin/login');
          }}
        >
          Super Admin sign in
        </Button>
      </section>
    </div>
  );
}
