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
 * ── The four states, and why they are ordered this way ───────────────────
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
 * Pure and free of any database import, because `listStudents` computes it on
 * the server from one grouped query and `StudentTable` renders it in the
 * browser, and a second copy of this ranking is how the chip and the filter
 * start disagreeing.
 */

export const STUDENT_FEE_STATUSES = [
  'admission_unpaid',
  'overdue',
  'due',
  'cleared',
] as const;

export type StudentFeeStatus = (typeof STUDENT_FEE_STATUSES)[number];

export const STUDENT_FEE_STATUS_LABELS: Record<StudentFeeStatus, string> = {
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
      return 'danger';
  }
}

/** What the school is looking at when the chip says this. For the filter's help text. */
export const STUDENT_FEE_STATUS_DESCRIPTIONS: Record<StudentFeeStatus, string> = {
  admission_unpaid: 'The admission voucher has not been settled.',
  overdue: 'At least one open voucher is past its due date.',
  due: 'There is an open voucher, and none of them is late yet.',
  cleared: 'No open voucher. Nothing is outstanding.',
};

/** The counts one grouped query over the student's *open* vouchers returns. */
export interface OpenVoucherCounts {
  /** Vouchers still `unpaid` or `partial`. */
  open: number;
  /** How many of those are past their due date. */
  overdue: number;
  /** How many of those are the admission voucher. */
  admission: number;
}

/**
 * The chip, from the counts. The ranking above, said once.
 *
 * A student with no open vouchers has no row in the grouped query at all, so
 * every caller passes zeroes for them rather than special-casing the absence.
 */
export function studentFeeStatusFrom(counts: OpenVoucherCounts): StudentFeeStatus {
  if (counts.admission > 0) return 'admission_unpaid';
  if (counts.overdue > 0) return 'overdue';
  if (counts.open > 0) return 'due';
  return 'cleared';
}

export function isStudentFeeStatus(value: unknown): value is StudentFeeStatus {
  return (
    typeof value === 'string' &&
    (STUDENT_FEE_STATUSES as readonly string[]).includes(value)
  );
}
