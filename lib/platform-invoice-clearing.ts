import 'server-only';

/**
 * When an invoice counts as settled — for blocking and for unblocking only.
 *
 * ── This file is `server-only`, and that is the point of it ──────────────
 * E6: the threshold is **never** shown — not on a school's screen, not in an
 * email, not on the PDF, and not on the super admin's own screens either. The
 * interface says "Received" and "Balance carried to next invoice" and nothing
 * else. A constant in `lib/platform-billing.ts` would reach the browser bundle
 * with the Billing tab, and a school administrator with devtools open would
 * find it in one search. Here, the bundler refuses to ship it at all: a client
 * component that imports this file fails the build rather than leaking it.
 *
 * Do not add it to an API response either, including as a boolean named after
 * it. The routes send `status`, which already says `paid`, and that is all
 * anybody needs.
 */

/** In basis points of the invoice total. */
const CLEARING_BASIS_POINTS = 8_000;

/**
 * Is an invoice with this much received cleared?
 *
 * Integer comparison — `received × 10,000 ≥ total × 8,000` — so there is no
 * rounding question to argue about at the boundary. A zero-value invoice is
 * cleared by definition: there is nothing left to pay.
 */
export function isInvoiceCleared(receivedMinor: number, totalMinor: number): boolean {
  if (totalMinor <= 0) return true;
  return receivedMinor * 10_000 >= totalMinor * CLEARING_BASIS_POINTS;
}
