'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Select } from '@/components/ui/Select';

/**
 * The campus selector — Sprint 19a, items 4, 11 and 13.
 *
 * ── It writes to the URL, and that is the whole design ───────────────────
 * `?branch=<id>`, so the selection is linkable, survives a refresh, works with
 * the back button, and is read on the *server* by `resolveBranchScope` — which
 * is what makes it a boundary rather than a filter the browser applies. Every
 * screen that offers it therefore already declares `force-dynamic`; this costs
 * no new render mode. A client-side filter over pre-fetched rows would have
 * meant shipping every campus's figures to somebody entitled to one of them.
 *
 * An unknown or out-of-scope id in the query string is **not** an error. The
 * resolver drops it and answers with the caller's whole scope: a stale
 * bookmark, a link pasted between colleagues at different campuses, and a
 * campus deactivated since the tab was opened all arrive as the same request,
 * and a 500 for any of them teaches people the product is broken.
 *
 * ── Item 13: one campus is not a question ────────────────────────────────
 * `options` arrives empty when the school has one campus, or when a
 * branch-bound reader can reach only their own. The component renders nothing
 * at all in that case — not a disabled control, not a single-entry dropdown. A
 * dropdown with one option is a question with one answer, and it invites a
 * click that cannot change anything.
 *
 * ── Pending state is this component's job ────────────────────────────────
 * CLAUDE.md: `loading.tsx` covers the server render, and anything a client
 * fetches after mount carries its own visible pending state. Changing the
 * campus is a navigation, so the control disables itself until the new render
 * arrives — otherwise a second change lands on top of the first and the two
 * race.
 *
 * ── And the pending state has to end by itself ───────────────────────────
 * It is spelled `useTransition` and not `useState(false)`, and that is the
 * whole of Sprint 26's item 1. `?branch=` changes the *search params* of the
 * route this component is already mounted on, so React keeps the same instance
 * across the navigation: a `setPending(true)` before `router.push` has nothing
 * downstream that ever sets it back, the control stays disabled with
 * *"Loading that campus…"* under it for ever, and the only way to pick a third
 * campus is to reload the page. The dashboard behind it had updated correctly
 * the whole time, which is what made it read as a stuck dropdown rather than a
 * failed navigation.
 *
 * A transition's `isPending` is owned by React and falls back to false when the
 * new render commits, whether that render is a different campus, the same one
 * again, or an error. There is no path that leaves it stuck.
 *
 * ── `chosen` exists because the select is controlled ─────────────────────
 * `selected` is a server prop and does not change until the new render lands,
 * so a controlled `<select>` would snap visibly back to the old campus for the
 * length of the request and then forward again. Holding the chosen id locally
 * while the transition runs is what stops that flicker; it is display only and
 * `resolveBranchScope` on the server remains the only thing that decides scope.
 */
export function BranchSelector({
  options,
  selected,
  allowsAll,
  label = 'Campus',
}: {
  options: readonly { id: string; name: string }[];
  /** The current selection, or null for every campus in scope. */
  selected: string | null;
  /** Whether *All campuses* is one of the answers. See `lib/branch-scope.ts`. */
  allowsAll: boolean;
  label?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [chosen, setChosen] = useState<string | null>(null);

  if (options.length === 0) return null;

  const change = (value: string): void => {
    const next = new URLSearchParams(search.toString());

    if (value === '') next.delete('branch');
    else next.set('branch', value);

    // Any campus change resets paging. A page number is an offset into a
    // different result set, and carrying it across would land the reader on
    // page four of a campus with two pages.
    next.delete('page');

    setChosen(value);
    const query = next.toString();

    startTransition(() => {
      router.push(query === '' ? pathname : `${pathname}?${query}`);
    });
  };

  return (
    <Select
      label={label}
      value={pending && chosen !== null ? chosen : (selected ?? '')}
      disabled={pending}
      hint={pending ? 'Loading that campus…' : undefined}
      options={[
        ...(allowsAll ? [{ value: '', label: 'All campuses' }] : []),
        ...options.map((option) => ({ value: option.id, label: option.name })),
      ]}
      onChange={(event) => {
        change(event.target.value);
      }}
    />
  );
}
