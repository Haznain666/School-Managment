/**
 * Shared constants for the printed exam documents.
 *
 * Same reason `lib/challan-print.ts` exists, and the same rule: a cap enforced
 * on both sides of the client/server line has to be declared once. The picker
 * that builds a print URL is a client component and the print page is a server
 * component, so neither can import the other; a number that drifted would
 * either offer a selection the print page refuses, or refuse one it would have
 * taken.
 *
 * Deliberately dependency-free — importing it must not drag anything
 * server-only into the browser bundle.
 */

/**
 * The most report cards one print job may carry.
 *
 * A real limit. Each card is a full term of results plus an attendance
 * summary for one child, and the browser print job is the renderer — past a
 * few hundred pages print dialogs start failing silently, which at a school
 * means a half-printed stack discovered while parents are queuing. The page
 * tells the operator to print by section instead of handing them a job that
 * dies part-way.
 *
 * 200 is also roughly what a section holds twice over, so the natural unit of
 * work — one class — is never near it.
 */
export const MAX_PRINTABLE_REPORT_CARDS = 200;

/**
 * The most students one tabulation sheet may carry.
 *
 * `SPRINTS.md` says the challan cap's reasoning applies here, and it does, but
 * the failure differs: a tabulation sheet is one wide table rather than N
 * documents, so exceeding it produces an unreadable sheet rather than a failed
 * job. The number matches the challan cap so nobody has to remember two.
 */
export const MAX_TABULATION_STUDENTS = 200;

/**
 * The most admit cards one print job may carry.
 *
 * Four to a sheet, so 200 cards is 50 sheets — the same order of magnitude as
 * the other two, and the same reason to stop there.
 */
export const MAX_PRINTABLE_ADMIT_CARDS = 200;

/** The report-card print URL for one term and one section. */
export function reportCardPrintHref(termId: string, sectionId: string): string {
  return `/dashboard/exams/report-cards/print?termId=${termId}&sectionId=${sectionId}`;
}

/** The report-card print URL for a single student. */
export function studentReportCardHref(
  termId: string,
  sectionId: string,
  studentProfileId: string,
): string {
  return `${reportCardPrintHref(termId, sectionId)}&studentProfileId=${studentProfileId}`;
}

/** The tabulation sheet for one exam. */
export function tabulationHref(examId: string): string {
  return `/dashboard/exams/${examId}/tabulation`;
}

/** The admit cards for one exam. */
export function admitCardHref(examId: string): string {
  return `/dashboard/exams/${examId}/admit-cards`;
}
