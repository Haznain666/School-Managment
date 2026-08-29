'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

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
  const [pending, setPending] = useState(false);

  if (options.length === 0) return null;

  const change = (value: string): void => {
    const next = new URLSearchParams(search.toString());

    if (value === '') next.delete('branch');
    else next.set('branch', value);

    // Any campus change resets paging. A page number is an offset into a
    // different result set, and carrying it across would land the reader on
    // page four of a campus with two pages.
    next.delete('page');

    setPending(true);
    const query = next.toString();
    router.push(query === '' ? pathname : `${pathname}?${query}`);
  };

  return (
    <Select
      label={label}
      value={selected ?? ''}
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
