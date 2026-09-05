/**
 * "Does this child owe the school anything?", as one word.
 *
 * ── Why the directory carries it at all ──────────────────────────────────
 * The question is asked at a counter, about one child, by somebody who has the
 * student directory open and no reason to leave it. Before this, answering it
 * meant opening the fee module, filtering the voucher register to that student
 * and reading four statuses — so in practice it was answered by asking the
 * parent, which is not an answer.
 *
 * ── The five states, and why they are ordered this way ───────────────────
 * A student can be in more than one of them at once: an unpaid admission
 * voucher three weeks past its due date is both `admission_unpaid` and
 * `overdue`. Exactly one chip is shown, so the states are ranked by how
 * specific the reason is rather than by severity — `Admission unpaid` names
 * *which* bill and is the one a clerk can act on, and every state below it is
 * some version of "there is money outstanding" that the same person is about to
 * look up anyway.
 *
 * The ranking is also what makes the listing's filter honest: filtering by
 * `Overdue` returns the students whose chip says Overdue, and not the ones
 * whose chip says something else for a stronger reason.
 *
 * ── Sprint 28: `cleared` was a lie, and it was a green one ───────────────
 * There were four states, and the fourth was reached by falling off the end of
 * the ranking: no open voucher, therefore `Cleared`, therefore a green chip
 * reading *nothing is outstanding*. A child admitted five minutes ago has no
 * open voucher either. They owe nothing because **nobody has asked them for
 * anything**, and reporting that as "nothing is outstanding" is how a fee goes
 * uncollected — a green chip is the one thing on a screen nobody re-checks.
 *
 * That is Askari's Student 50: enrolled, `fee_status = 'outstanding'`, no
 * `fee_challans` row at all, and a green `Cleared` chip in the directory that
 * was indistinguishable from a family who had paid in full. `not_billed` is
 * that case named, ranked last because it is the one thing a green chip must
 * never absorb, and coloured `danger` because an unbilled child is a debt the
 * school has not yet noticed it is owed.
 *
 * ── And why a hand-cleared enrollment reads `cleared`, not `not_billed` ──
 * `clearEnrolmentFee` is the cash-across-a-desk path: a clerk takes the money,
 * presses *Confirm the fee was paid*, and the enrollment moves to `cleared`
 * with no voucher ever having existed. Counting vouchers alone would file that
 * child under "nobody has billed them", which is false and would put a
 * settled family on a chasing list. Somebody has said in writing that it was
 * paid, and their say-so is the record. So the absence of a voucher only means
 * `not_billed` when the enrollment is still `outstanding` — no voucher *and*
 * nobody's word for it.
 *
 * Pure and free of any database import, because `listStudents` computes it on
 * the server from one grouped query and `StudentTable` renders it in the
 * browser, and a second copy of this ranking is how the chip and the filter
 * start disagreeing.
 */

export const STUDENT_FEE_STATUSES = [
  // First, because the array order is what the filter dropdown renders in and
  // this is the most specific state of the five — the one a reader is looking
  // for by name when they open the filter at all.
  'not_billed',
  'admission_unpaid',
  'overdue',
  'due',
  'cleared',
] as const;

export type StudentFeeStatus = (typeof STUDENT_FEE_STATUSES)[number];

export const STUDENT_FEE_STATUS_LABELS: Record<StudentFeeStatus, string> = {
  not_billed: 'Not billed',
  admission_unpaid: 'Admission unpaid',
  overdue: 'Overdue',
  due: 'Due',
  cleared: 'Cleared',
};

/** The `Badge` variant each state wears. Danger is owed *and* late, or owed at admission. */
export function studentFeeStatusVariant(
  status: StudentFeeStatus,
): 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'cleared':
      return 'success';
    case 'due':
      return 'warning';
    case 'overdue':
    case 'admission_unpaid':
    // Not `warning`. Nothing has gone wrong with a voucher here — there is no
    // voucher, which is a worse fact and one only this screen will report.
    case 'not_billed':
      return 'danger';
  }
}

/** What the school is looking at when the chip says this. For the filter's help text. */
export const STUDENT_FEE_STATUS_DESCRIPTIONS: Record<StudentFeeStatus, string> = {
  not_billed: 'No voucher has ever been raised for this student.',
  admission_unpaid: 'The admission voucher has not been settled.',
  overdue: 'At least one open voucher is past its due date.',
  due: 'There is an open voucher, and none of them is late yet.',
  cleared: 'No open voucher. Nothing is outstanding.',
};

/** The counts one grouped query over the student's vouchers returns. */
export interface OpenVoucherCounts {
  /** Vouchers still `unpaid` or `partial`. */
  open: number;
  /** How many of those are past their due date. */
  overdue: number;
  /** How many of those are the admission voucher. */
  admission: number;
  /**
   * Every voucher this student has that is not `cancelled`, in any status.
   *
   * The one that separates "paid everything" from "never billed", and the
   * reason the grouped query is no longer restricted to open vouchers: a
   * student with a paid voucher and a student with no voucher both have zero
   * open ones, and only this number tells them apart.
   */
  live: number;
  /** The active enrollment's `fee_status` is `cleared` — somebody's say-so. */
  enrolmentCleared: boolean;
}

/**
 * The chip, from the counts. The ranking above, said once.
 *
 * A student with no voucher at all has no row in the grouped query, so every
 * caller passes zeroes for them rather than special-casing the absence — and
 * `live: 0` with `enrolmentCleared: false` is precisely what `not_billed`
 * means.
 */
export function studentFeeStatusFrom(counts: OpenVoucherCounts): StudentFeeStatus {
  if (counts.admission > 0) return 'admission_unpaid';
  if (counts.overdue > 0) return 'overdue';
  if (counts.open > 0) return 'due';
  if (counts.live === 0 && !counts.enrolmentCleared) return 'not_billed';
  return 'cleared';
}

export function isStudentFeeStatus(value: unknown): value is StudentFeeStatus {
  return (
    typeof value === 'string' &&
    (STUDENT_FEE_STATUSES as readonly string[]).includes(value)
  );
}
