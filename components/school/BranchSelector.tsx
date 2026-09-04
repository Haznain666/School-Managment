'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

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
── Why this control has no pending state of its own ─────────────────────
 * It had one — `useState(false)` set to true immediately before `router.push`
 * — and that was Sprint 26's item 1. Changing the parameter changes the *search
 * params* of the route the component is already mounted on, so it is not
 * unmounted and remounted; nothing downstream ever set the flag back, and the
 * control stayed disabled with a "Loading…" hint under it until the page was
 * reloaded. The screen behind it updated correctly the whole time, which is
 * what made it read as a stuck dropdown rather than a failed navigation.
 *
 * Two obvious repairs were tried in a browser against this app and **both
 * failed**, which is why neither is here:
 *
 *   · `useTransition` around the push — `isPending` was still true twenty
 *     seconds after the new page had finished rendering;
 *   · clearing the flag from an effect on the new `?param=` — the effect never
 *     ran, because this component does not re-render when the navigation lands.
 *     The page's content changes and its props change; this subtree is not
 *     re-rendered with them.
 *
 * Each of those is the same bug wearing a better disguise, and the second is
 * worse than the first because it looks correct in review.
 *
 * So there is no local pending state at all, and there does not need to be:
 * `components/ui/RouteProgress.tsx` is mounted once in the root layout, counts
 * every in-flight App Router navigation by intercepting the `RSC: 1` fetch that
 * `router.push` issues, and carries its own fallback timer for a request that
 * never settles. It is the product's existing answer to exactly this gap, and
 * CLAUDE.md names it as such. A second, private, per-control indicator was
 * duplicating it — and unlike it, could wedge.
 *
 * ── And the race the `disabled` was for is benign ────────────────────────
 * Two changes in quick succession are two pushes to the same route with
 * different search params. The router supersedes the first with the second and
 * the page is idempotent per URL, so the loser of that race is a render nobody
 * sees. That is a much smaller cost than a control which cannot be used twice.
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

  if (options.length === 0) return null;

  const change = (value: string): void => {
    const next = new URLSearchParams(search.toString());

    if (value === '') next.delete('branch');
    else next.set('branch', value);

    // Any campus change resets paging. A page number is an offset into a
    // different result set, and carrying it across would land the reader on
    // page four of a campus with two pages.
    next.delete('page');

    const query = next.toString();
    router.push(query === '' ? pathname : `${pathname}?${query}`);
  };

  return (
    <Select
      label={label}
      value={selected ?? ''}
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
