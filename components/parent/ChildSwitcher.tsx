'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

/**
 * The child this parent is currently looking at, in the portal header.
 *
 * ── Why it belongs in the header and not only on the page ────────────────
 * The selector already existed as a row of pills (`ChildSelector`), repeated on
 * each of the six parent screens that take a `?child=`. That works — but it is
 * below the fold on a phone, it is absent from the screens that do not take the
 * parameter, and it puts the answer to "whose attendance am I reading" in a
 * different place on every page.
 *
 * A parent with three children at one school is reading three records through
 * one login, and *which one* is the single most important piece of state in the
 * portal. In the header it is always in the same place, always visible, and
 * survives navigation.
 *
 * ── One child renders as text, not as a control ──────────────────────────
 * Most families have one child at a school. A dropdown offering a single option
 * is a control that cannot be used, and putting one there teaches a parent to
 * stop looking at it.
 *
 * ── Why a native select ──────────────────────────────────────────────────
 * It is the one menu that is already keyboard-navigable, screen-reader
 * announced, and — on the phone this portal is mostly read on — rendered by the
 * operating system as a full-height picker rather than as a list that has to be
 * scrolled inside a 64-pixel bar.
 *
 * ── The `?child=` parameter is not an authorisation boundary ─────────────
 * It selects among children the parent's own query already returned. Every
 * parent page re-checks the id against that list and falls back to the first
 * child when it does not match, so a hand-edited URL reaches nobody else's
 * record. This component only writes the parameter; it never decides who may
 * read it.
 */

export interface ChildSwitcherProps {
  /**
   * Deliberately not called `children`. That name is React's, and passing a
   * data array under it is both a lint error and a component whose signature
   * lies about what nesting tags inside it would do — the same reasoning as
   * `ChildSelector`.
   */
  students: readonly { studentProfileId: string; studentId: string; name: string }[];
}

export function ChildSwitcher({ students }: ChildSwitcherProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  if (students.length === 0) return null;

  // Read from the URL rather than passed in: this renders inside the portal
  // layout, and a layout in the App Router is not given `searchParams` — it is
  // not re-rendered when they change.
  const selectedId = params.get('child');

  const current = students.find((child) => child.studentProfileId === selectedId);
  const shown = current ?? students[0];
  if (shown === undefined) return null;

  if (students.length === 1) {
    return (
      <div className="hidden min-w-0 border-l border-brand-onPrimary/20 pl-3 sm:block">
        <p className="text-[0.6875rem] uppercase tracking-wide opacity-70">Viewing</p>
        <p className="truncate text-sm font-medium">{shown.name}</p>
      </div>
    );
  }

  const move = (studentProfileId: string): void => {
    const next = new URLSearchParams(params.toString());
    next.set('child', studentProfileId);

    startTransition(() => {
      router.push(`${pathname}?${next.toString()}`);
      // The parent pages are server components reading `?child=` — the push
      // alone re-renders them, but a page that had already been fetched for the
      // other child would otherwise be served from the router cache.
      router.refresh();
    });
  };

  return (
    <div className="min-w-0 border-l border-brand-onPrimary/20 pl-3">
      <label
        htmlFor="child-switcher"
        className="block text-[0.6875rem] uppercase tracking-wide opacity-70"
      >
        Viewing
      </label>
      <select
        id="child-switcher"
        value={shown.studentProfileId}
        disabled={isPending}
        onChange={(event) => {
          move(event.target.value);
        }}
        /*
          Transparent, inheriting the header's own lettering, so it reads as
          part of the bar rather than as a form control dropped into it. The
          option list is painted by the browser in its own colours, which is
          why each option sets an explicit one — on a dark primary the
          inherited white would otherwise be white-on-white in the open menu.
        */
        className="-ml-1 max-w-[12rem] cursor-pointer truncate rounded border-0 bg-transparent px-1 py-0.5 text-sm font-medium text-brand-onPrimary outline-none focus-visible:ring-2 focus-visible:ring-brand-onPrimary/60 disabled:opacity-60"
      >
        {students.map((child) => (
          <option
            key={child.studentProfileId}
            value={child.studentProfileId}
            className="bg-surface text-ink"
          >
            {child.name} — {child.studentId}
          </option>
        ))}
      </select>
    </div>
  );
}
