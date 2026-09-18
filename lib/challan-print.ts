/**
 * Shared constants for bulk challan printing.
 *
 * This module exists so the challan list and the print page agree on the cap.
 * They are on opposite sides of the client/server line — the list is a client
 * component, the print page is a server component — so neither can import the
 * other. A cap that disagreed would either offer a selection the print page
 * refuses, or refuse one it would have accepted.
 *
 * Deliberately dependency-free for that reason: importing it must not drag
 * anything server-only into the browser bundle.
 */

/**
 * The most challans one print job may carry.
 *
 * A real limit, not a placeholder. Each challan is one `getChallanDetail`
 * round trip, so the print page runs N queries; and a browser print job of
 * more than a few hundred pages is where print dialogs start to fail silently.
 * Beyond the cap the user is told to narrow the selection rather than being
 * handed a job that dies halfway.
 *
 * It also keeps the URL sane. The ids travel on the query string, so 200 uuids
 * is roughly 7 KB of URL, which sits alongside the session cookie inside
 * Node's 16 KB header budget. Raising this materially means moving the
 * selection out of the URL — a POST, or re-running the list's filters
 * server-side — not just changing this number.
 */
export const MAX_PRINTABLE_CHALLANS = 200;

/**
 * Which document a bulk run prints.
 *
 * Sprint 33c. One run, one kind — never a mixture. A stack in which some
 * sheets are demands and some are receipts is a stack nobody can hand out, and
 * the person sorting it has to read every one to know which is which. The
 * filters on the list already separate open vouchers from settled ones, so a
 * school prints one run of each rather than one run of both.
 */
export type BulkPrintDocument = 'voucher' | 'receipt';

/** The bulk print URL for a set of challan ids. */
export function challanPrintHref(
  ids: readonly string[],
  document: BulkPrintDocument = 'voucher',
): string {
  const suffix = document === 'receipt' ? '&document=receipt' : '';
  return `/dashboard/fees/challans/print?ids=${ids.join(',')}${suffix}`;
}
