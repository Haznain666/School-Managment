'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

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
 * ── Pending state is this component's job ────────────────────────────────
 * Changing the period is a navigation, so the control disables itself until the
 * new render arrives; otherwise a second change lands on top of the first and
 * the two race.
 */
export function DashboardPeriodSelector({ selected }: { selected: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, setPending] = useState(false);

  const change = (value: string): void => {
    const next = new URLSearchParams(search.toString());

    // `year` is the default the page falls back to, so it is expressed as the
    // *absence* of the parameter. A URL that says nothing and a URL that says
    // `period=year` must not be two different links to one view.
    if (value === 'year') next.delete('period');
    else next.set('period', value);

    setPending(true);
    const query = next.toString();
    router.push(query === '' ? pathname : `${pathname}?${query}`);
  };

  return (
    <Select
      label="Period"
      value={selected}
      disabled={pending}
      hint={pending ? 'Loading that period…' : undefined}
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
