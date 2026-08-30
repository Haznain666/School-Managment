/**
 * The period the owner's two campus money charts are about — Sprint 20, item 2d.
 *
 * Deliberately dependency-free, and free of `server-only` in particular. The
 * page reads the parameter on the server and the selector writes it in the
 * browser, so both halves import this file as **values** — which is the shape
 * STATE.md §5bg records the build refusing when the module underneath opens
 * with `import 'server-only'`. There is nothing here but three constants and a
 * type guard; keep it that way.
 */

export const DASHBOARD_PERIODS = ['month', 'year'] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];

export const DASHBOARD_PERIOD_LABELS: Record<DashboardPeriod, string> = {
  month: 'This month',
  year: 'This academic year',
};

/**
 * The period in words, for a card's description.
 *
 * The card says which period it is about rather than relying on the dropdown
 * beside it, because a dashboard is screenshotted and printed, and a chart
 * captioned only by a control that did not come with it is a chart nobody can
 * date afterwards.
 */
export const DASHBOARD_PERIOD_PHRASES: Record<DashboardPeriod, string> = {
  month: 'this month',
  year: 'this academic year',
};

/**
 * The default, and it is `year`.
 *
 * That is what *Collection by campus* has shown since Sprint 19a, so a school
 * opening the dashboard the morning this deploys sees exactly the figures it
 * saw yesterday. Changing the default would silently restate every campus's
 * collection as one month's worth on a screen an owner reads as a running
 * total.
 */
export const DEFAULT_DASHBOARD_PERIOD: DashboardPeriod = 'year';

/**
 * The `?period=` value off a request, or the default.
 *
 * An unrecognised value falls back rather than erroring, for the same reason
 * `resolveBranchScope` drops an unknown `?branch=`: a stale bookmark and a
 * link pasted between colleagues arrive as the same request, and a 500 for
 * either teaches people the product is broken.
 */
export function readDashboardPeriod(value: unknown): DashboardPeriod {
  return typeof value === 'string' &&
    (DASHBOARD_PERIODS as readonly string[]).includes(value)
    ? (value as DashboardPeriod)
    : DEFAULT_DASHBOARD_PERIOD;
}
