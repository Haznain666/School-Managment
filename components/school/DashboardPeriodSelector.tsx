'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { Select } from '@/components/ui/Select';
import { DASHBOARD_PERIODS, DASHBOARD_PERIOD_LABELS } from '@/lib/dashboard-period';

/**
 * The period the owner's two campus money charts are about — Sprint 20, item 2d.
 *
 * ── One parameter, read by both charts ───────────────────────────────────
 * `?period=month` / `?period=year`, and it is deliberately **one** selector's
 * worth of state rendered in two card headers rather than two selectors. Two
 * controls that can disagree produce a screen whose two halves are about
 * different periods with nothing anywhere saying so — an owner comparing
 * *Collection by campus* against *Income against expense by campus* would be
 * comparing a year against a month and would have no way to notice.
 *
 * It writes to the URL for exactly the reasons `BranchSelector` beside it does:
 * the view is linkable, survives a refresh, works with the back button, and is
 * read on the **server**, so the figures are narrowed before they are sent
 * rather than after. The dashboard is already `force-dynamic`, so a second
 * search parameter costs nothing — CLAUDE.md's "do not make a static page
 * dynamic by accident" does not apply to a page that was never static.
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
export function DashboardPeriodSelector({ selected }: { selected: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  const change = (value: string): void => {
    const next = new URLSearchParams(search.toString());

    // `year` is the default the page falls back to, so it is expressed as the
    // *absence* of the parameter. A URL that says nothing and a URL that says
    // `period=year` must not be two different links to one view.
    if (value === 'year') next.delete('period');
    else next.set('period', value);

    const query = next.toString();
    router.push(query === '' ? pathname : `${pathname}?${query}`);
  };

  return (
    <Select
      label="Period"
      value={selected}
      options={DASHBOARD_PERIODS.map((value) => ({
        value,
        label: DASHBOARD_PERIOD_LABELS[value],
      }))}
      onChange={(event) => {
        change(event.target.value);
      }}
    />
  );
}
