import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';

import {
  OPEN_CHALLAN_STATUSES,
  feeChallans,
  studentEnrollments,
} from '@/db/schema';

import { db } from './drizzle';
import { welcomeStudentGuardians, type ProvisionResult } from './parent-portal-access';

/**
 * The admission fee gate: a newly admitted student counts as enrolled once the
 * school has been paid, and that is the moment their parents are welcomed.
 *
 * ── What "paid" means here, precisely ────────────────────────────────────
 * The student holds **at least one** challan and **none** of their challans is
 * still open — `unpaid` or `partial`. Both halves matter and both are chosen
 * rather than inherited:
 *
 *   * "at least one" is what keeps a child admitted five minutes ago, before
 *     anybody has generated a bill, in the outstanding state. Without it, zero
 *     challans would read as zero debt and every admission would clear itself
 *     instantly, which is the exact opposite of the rule.
 *
 *   * "none still open" rather than "the admission challan is paid", because
 *     this product has no admission-fee challan type. A school bills what it
 *     bills; what it is owed is the sum of the open ones. `cancelled` and
 *     `waived` are closed on purpose — a waived fee is a decision a human made
 *     and it settles the account as surely as cash does.
 *
 * ── The escape hatch, and why it is not optional ─────────────────────────
 * Schools take money at a desk, in cash, without a challan, all the time. If
 * the only way out of `outstanding` were the challan ledger, a school that
 * works that way would have a roll of children whose parents never receive a
 * login and no button anywhere to fix it. `clearEnrolmentFee` is that button;
 * `admissions.write` is what it costs.
 *
 * ── It never throws ──────────────────────────────────────────────────────
 * Every caller has just committed something more important than this: a
 * payment, a waiver, an admission. A failure here is logged and swallowed, and
 * the state it failed to reach is reachable again by the next payment or by the
 * button. Money must not be lost to an email.
 */

export interface FeeGateOutcome {
  /** True when this call moved the enrolment from outstanding to cleared. */
  cleared: boolean;
  /** What was sent, when it cleared. Empty otherwise. */
  welcomes: ProvisionResult[];
  /** Why it did not clear, for a log line. Null when it did, or had already. */
  reason: string | null;
}

const NOTHING: FeeGateOutcome = { cleared: false, welcomes: [], reason: null };

/**
 * Re-evaluates one student's fee clearance and, if it has just cleared, welcomes
 * their guardians.
 *
 * Safe to call after every payment. A student already `cleared` returns
 * immediately without touching the guardians, which is what makes the second
 * and third payments of the term cost one indexed read.
 */
export async function settleEnrolmentIfFeePaid(input: {
  locationId: string;
  studentProfileId: string;
  actorUid: string;
}): Promise<FeeGateOutcome> {
  const { locationId, studentProfileId, actorUid } = input;

  try {
    const enrolments = await db
      .select({
        id: studentEnrollments.id,
        feeStatus: studentEnrollments.feeStatus,
      })
      .from(studentEnrollments)
      .where(
        and(
          eq(studentEnrollments.locationId, locationId),
          eq(studentEnrollments.studentProfileId, studentProfileId),
          eq(studentEnrollments.status, 'active'),
        ),
      )
      .limit(1);

    const enrolment = enrolments[0];
    if (enrolment === undefined) {
      return { ...NOTHING, reason: 'No active enrolment.' };
    }
    if (enrolment.feeStatus === 'cleared') return NOTHING;

    const challans = await db
      .select({ status: feeChallans.status })
      .from(feeChallans)
      .where(
        and(
          eq(feeChallans.locationId, locationId),
          eq(feeChallans.studentProfileId, studentProfileId),
        ),
      );

    if (challans.length === 0) {
      return { ...NOTHING, reason: 'No challan has been issued yet.' };
    }

    const stillOwing = challans.some((challan) =>
      OPEN_CHALLAN_STATUSES.includes(challan.status),
    );

    if (stillOwing) {
      return { ...NOTHING, reason: 'A challan is still unpaid.' };
    }

    return await clearEnrolmentFee({ locationId, studentProfileId, actorUid });
  } catch (error) {
    console.error('[fee-gate] could not evaluate the fee gate:', error);
    return { ...NOTHING, reason: 'The fee gate could not be evaluated.' };
  }
}

/**
 * Marks the active enrolment cleared and welcomes the guardians.
 *
 * The UPDATE is conditional on the row still being `outstanding`, so two
 * payments landing in the same instant produce one clearing and one no-op —
 * and therefore one set of welcome emails, not two. That guard is in the WHERE
 * clause rather than in a prior read for exactly that reason.
 */
export async function clearEnrolmentFee(input: {
  locationId: string;
  studentProfileId: string;
  actorUid: string;
}): Promise<FeeGateOutcome> {
  const { locationId, studentProfileId, actorUid } = input;

  try {
    const updated = await db
      .update(studentEnrollments)
      .set({ feeStatus: 'cleared', feeClearedAt: new Date() })
      .where(
        and(
          eq(studentEnrollments.locationId, locationId),
          eq(studentEnrollments.studentProfileId, studentProfileId),
          eq(studentEnrollments.status, 'active'),
          eq(studentEnrollments.feeStatus, 'outstanding'),
        ),
      )
      .returning({ id: studentEnrollments.id });

    if (updated[0] === undefined) {
      return { ...NOTHING, reason: 'Already cleared, or no active enrolment.' };
    }

    const welcomes = await welcomeStudentGuardians({
      locationId,
      studentProfileId,
      actorUid,
    });

    return { cleared: true, welcomes, reason: null };
  } catch (error) {
    console.error('[fee-gate] could not clear the enrolment:', error);
    return { ...NOTHING, reason: 'The enrolment could not be cleared.' };
  }
}

/**
 * The students behind a set of challans, for the payment routes.
 *
 * A payment names a challan, and the gate is about a student. One indexed read
 * rather than a second round trip per challan — §5q measured ~2.4 seconds per
 * round trip to Supabase, and the family challan path settles several at once.
 */
export async function studentsBehindChallans(
  locationId: string,
  challanIds: readonly string[],
): Promise<string[]> {
  if (challanIds.length === 0) return [];

  const rows = await db
    .selectDistinct({ studentProfileId: feeChallans.studentProfileId })
    .from(feeChallans)
    .where(
      and(
        eq(feeChallans.locationId, locationId),
        inArray(feeChallans.id, [...challanIds]),
      ),
    );

  return rows.map((row) => row.studentProfileId);
}
