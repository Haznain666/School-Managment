import type { PromotionMechanism } from '@/db/schema/grade-promotion-criteria';
import type { PromotionStatus } from '@/db/schema/student-term-results';

/**
 * The two rule engines that decide whether a child moves up, written once.
 *
 * Pure functions and no database, for the third time in this codebase and for
 * the third time for the same reason: the criteria editor previews a decision
 * in the browser, the recompute applies it on the server, and the class
 * teacher's screen explains it. Three renderings of "would this child be
 * promoted" and one implementation.
 *
 * ── When a criterion is null it is NOT APPLIED ───────────────────────────
 * Not treated as zero. A grade whose row sets only `minOverallPercentage` is
 * judged on that alone, and a grade with every threshold null computes
 * `promoted` for everybody. This product has never withheld a promotion by
 * itself, and a screen a school filled in half of must not start doing so
 * silently — the failure mode being avoided is a school pressing "recompute"
 * and finding a class of forty marked not promoted by a default nobody chose.
 *
 * ── `reasons` is an output, not a log ────────────────────────────────────
 * It is shown to the class teacher beside the computed status, because a
 * teacher asked to override a decision needs to see what they are overriding.
 * A status with no explanation next to it is a status that gets overridden on
 * a hunch.
 */

export type { PromotionMechanism, PromotionStatus };

/** The criteria row as the engines need it, with the NUMERICs already parsed. */
export interface CriteriaRow {
  mechanism: PromotionMechanism;
  /** Null = the school's default grading scheme. Marks mode only. */
  gradingSchemeId: string | null;
  minOverallPercentage: number | null;
  maxFailedSubjects: number | null;
  failingSubcategoryId: string | null;
  maxFailingSubjects: number | null;
  minAttendancePercentage: number | null;
}

/**
 * What a grade with no criteria row is judged by.
 *
 * `marks_grades`, the school's default scheme and no thresholds — which is
 * exactly how the product behaved before `grade_promotion_criteria` existed.
 * A school that never opens the criteria screen sees no change at all, and
 * that is the test this constant has to pass.
 */
export const DEFAULT_CRITERIA: CriteriaRow = {
  mechanism: 'marks_grades',
  gradingSchemeId: null,
  minOverallPercentage: null,
  maxFailedSubjects: null,
  failingSubcategoryId: null,
  maxFailingSubjects: null,
  minAttendancePercentage: null,
};

export interface PromotionOutcome {
  status: PromotionStatus;
  /** Every rule that was applied, in the words the class teacher reads. */
  reasons: string[];
}

/** A percentage for a sentence: `62.5%`, not `62.50%`. */
function pct(value: number): string {
  return `${Math.round(value * 10) / 10}%`;
}

/**
 * Attendance, which is the one rule both mechanisms share.
 *
 * A child with no attendance figure at all — the register was never taken for
 * their class — is not failed on it. Refusing a promotion because the school
 * did not mark a register is refusing it for the school's own omission.
 */
function attendanceProblem(
  attendancePercentage: number | null,
  minimum: number | null,
): string | null {
  if (minimum === null) return null;
  if (attendancePercentage === null) return null;
  if (attendancePercentage >= minimum) return null;

  return `Attendance ${pct(attendancePercentage)} is below the ${pct(minimum)} required.`;
}

/**
 * Marks mode: an overall percentage, a count of failed subjects, attendance.
 *
 * `overallPercentage` is the arithmetic mean of the subject percentages — see
 * `overallPercentage` in `lib/grading.ts` for why the mean and not the ratio of
 * totals. A child with no marks at all arrives here as null and is not failed
 * on it: they have not been examined, which is not the same as having done
 * badly, and the school will have a reason for that which is not the engine's
 * business.
 */
export function computeMarksPromotion(input: {
  overallPercentage: number | null;
  failedSubjectCount: number;
  attendancePercentage: number | null;
  criteria: CriteriaRow;
}): PromotionOutcome {
  const { overallPercentage, failedSubjectCount, attendancePercentage, criteria } =
    input;
  const reasons: string[] = [];
  let status: PromotionStatus = 'promoted';

  if (criteria.minOverallPercentage !== null && overallPercentage !== null) {
    if (overallPercentage < criteria.minOverallPercentage) {
      status = 'not_promoted';
      reasons.push(
        `Overall ${pct(overallPercentage)} is below the ${pct(criteria.minOverallPercentage)} required.`,
      );
    } else {
      reasons.push(
        `Overall ${pct(overallPercentage)} meets the ${pct(criteria.minOverallPercentage)} required.`,
      );
    }
  }

  if (criteria.maxFailedSubjects !== null) {
    if (failedSubjectCount > criteria.maxFailedSubjects) {
      status = 'not_promoted';
      reasons.push(
        `Failed ${failedSubjectCount} subject${failedSubjectCount === 1 ? '' : 's'}; at most ${criteria.maxFailedSubjects} allowed.`,
      );
    } else {
      reasons.push(
        `Failed ${failedSubjectCount} subject${failedSubjectCount === 1 ? '' : 's'}, within the ${criteria.maxFailedSubjects} allowed.`,
      );
    }
  }

  const attendance = attendanceProblem(
    attendancePercentage,
    criteria.minAttendancePercentage,
  );
  if (attendance !== null) {
    status = 'not_promoted';
    reasons.push(attendance);
  }

  if (reasons.length === 0) {
    reasons.push('No promotion criteria are set for this class, so nobody is held back.');
  }

  return { status, reasons };
}

/**
 * Descriptor mode: how many subjects landed in the failing descriptor.
 *
 * There is no percentage here and no grade, by design. `failingSubjectCount` is
 * the number of this term's subjects whose descriptor is the one the school
 * named as failing — `criteria.failingSubcategoryId`. A school that has not
 * named one has no way to fail anybody in this mechanism, and that is a real
 * state rather than a misconfiguration: plenty of primary schools describe
 * performance without ever using it to hold a child back.
 */
export function computeDescriptorPromotion(input: {
  failingSubjectCount: number;
  attendancePercentage: number | null;
  criteria: CriteriaRow;
}): PromotionOutcome {
  const { failingSubjectCount, attendancePercentage, criteria } = input;
  const reasons: string[] = [];
  let status: PromotionStatus = 'promoted';

  if (criteria.failingSubcategoryId === null) {
    reasons.push(
      'This class has no failing sub-category set, so its descriptors do not hold anybody back.',
    );
  } else if (criteria.maxFailingSubjects === null) {
    reasons.push(
      `${failingSubjectCount} subject${failingSubjectCount === 1 ? '' : 's'} in the failing sub-category; no limit is set.`,
    );
  } else if (failingSubjectCount > criteria.maxFailingSubjects) {
    status = 'not_promoted';
    reasons.push(
      `${failingSubjectCount} subject${failingSubjectCount === 1 ? '' : 's'} in the failing sub-category; at most ${criteria.maxFailingSubjects} allowed.`,
    );
  } else {
    reasons.push(
      `${failingSubjectCount} subject${failingSubjectCount === 1 ? '' : 's'} in the failing sub-category, within the ${criteria.maxFailingSubjects} allowed.`,
    );
  }

  const attendance = attendanceProblem(
    attendancePercentage,
    criteria.minAttendancePercentage,
  );
  if (attendance !== null) {
    status = 'not_promoted';
    reasons.push(attendance);
  }

  return { status, reasons };
}

/**
 * What is wrong with a criteria row a school is trying to save, or null.
 *
 * Shared by the criteria screen and the `PUT` that backs it. The database
 * CHECK covers the percentages; this covers the pairs it cannot see — a
 * negative subject count, and a descriptor limit set against no failing
 * descriptor, which would silently never fire.
 */
export function criteriaProblem(criteria: CriteriaRow): string | null {
  for (const [value, label] of [
    [criteria.minOverallPercentage, 'The minimum overall percentage'],
    [criteria.minAttendancePercentage, 'The minimum attendance percentage'],
  ] as const) {
    if (value === null) continue;
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      return `${label} must be between 0 and 100.`;
    }
  }

  for (const [value, label] of [
    [criteria.maxFailedSubjects, 'The number of failed subjects allowed'],
    [criteria.maxFailingSubjects, 'The number of failing subjects allowed'],
  ] as const) {
    if (value === null) continue;
    if (!Number.isInteger(value) || value < 0 || value > 50) {
      return `${label} must be a whole number between 0 and 50.`;
    }
  }

  if (
    criteria.mechanism === 'descriptors' &&
    criteria.maxFailingSubjects !== null &&
    criteria.failingSubcategoryId === null
  ) {
    return 'Choose which sub-category counts as a fail before setting how many are allowed.';
  }

  return null;
}
