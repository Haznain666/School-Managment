/**
 * The aging buckets a fee debt falls into, and what a reader calls each one.
 *
 * ── Why this is not in `lib/defaulters.ts`, where it was ─────────────────
 * That module opens with `import 'server-only'`, because it reads the database.
 * These five constants read nothing — but Sprint 18 moved the aged-debt screen
 * onto `DataTable`, and a `'use client'` table needs the bucket list to build
 * its filter and the labels to render its chips. Importing them from
 * `lib/defaulters.ts` pulled `db/drizzle` into the browser bundle behind them,
 * and `next build` refused it:
 *
 *     ./lib/defaulters.ts
 *     Error: You're importing a component that needs "server-only".
 *
 * Nothing else caught it. `typecheck`, `lint` and all seven check scripts were
 * green — a `server-only` violation is a bundling fact, and the build is the
 * only gate that has a bundler in it. That is the argument for the build
 * staying in CLAUDE.md's list of nine rather than being treated as the slow one
 * to skip.
 *
 * So the definitions live here, with no imports at all, and
 * `lib/defaulters.ts` re-exports them. Every existing server-side caller is
 * unchanged; the client imports this file directly.
 *
 * ── The buckets themselves ──────────────────────────────────────────────
 * Aging is by **due date**, not issue date. A voucher raised on the 1st and due
 * on the 10th is not overdue on the 5th, and bucketing from issue would put
 * every current voucher in the first bucket and make the report useless in the
 * first week of every month — which is when it is read most.
 *
 * `current` is shown rather than hidden because an accountant chasing arrears
 * wants the household's whole position before they telephone. Arriving at "you
 * owe 4,000" and being told "I paid this month's" is how a collection call goes
 * wrong.
 */

export const AGING_BUCKETS = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'] as const;

export type AgingBucket = (typeof AGING_BUCKETS)[number];

export const BUCKET_LABELS: Record<AgingBucket, string> = {
  current: 'Not yet due',
  d1_30: '1–30 days',
  d31_60: '31–60 days',
  d61_90: '61–90 days',
  d90_plus: 'Over 90 days',
};

export function isAgingBucket(value: unknown): value is AgingBucket {
  return typeof value === 'string' && (AGING_BUCKETS as readonly string[]).includes(value);
}
