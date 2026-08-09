import 'server-only';

import { and, desc, eq, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import {
  branches,
  feeChallans,
  grades,
  schoolUsers,
  sections,
  studentEnrollments,
  studentProfiles,
  studentTransfers,
  OPEN_CHALLAN_STATUSES,
} from '@/db/schema';

import { db } from './drizzle';

/**
 * Moving a student between campuses.
 *
 * ── A transfer is recorded, not applied in place ─────────────────────────
 * The enrolment is closed as `transferred` and a new one opened at the
 * receiving branch — the same shape promotion uses, and for the same reason. A
 * school is asked three things afterwards, always by somebody holding a
 * challan: when the child left, when they started, and what happened to the
 * money in between. Editing `student_enrollments.section_id` answers none of
 * them.
 */

export class TransferError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'TransferError';
    this.status = status;
  }
}

export interface TransferCandidate {
  studentProfileId: string;
  name: string;
  studentId: string;
  enrollmentId: string;
  academicYearId: string;
  sectionId: string;
  sectionName: string;
  gradeId: string;
  gradeName: string;
  branchId: string;
  branchName: string;
}

/** The student's current active enrolment, with everything a transfer needs. */
export async function getTransferCandidate(
  locationId: string,
  studentProfileId: string,
): Promise<TransferCandidate | null> {
  const rows = await db
    .select({
      studentProfileId: studentProfiles.id,
      name: schoolUsers.name,
      studentId: studentProfiles.studentId,
      enrollmentId: studentEnrollments.id,
      academicYearId: studentEnrollments.academicYearId,
      sectionId: sections.id,
      sectionName: sections.name,
      gradeId: grades.id,
      gradeName: grades.name,
      branchId: branches.id,
      branchName: branches.name,
    })
    .from(studentEnrollments)
    .innerJoin(sections, eq(sections.id, studentEnrollments.sectionId))
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .innerJoin(branches, eq(branches.id, grades.branchId))
    .innerJoin(studentProfiles, eq(studentProfiles.id, studentEnrollments.studentProfileId))
    .innerJoin(schoolUsers, eq(schoolUsers.id, studentProfiles.schoolUserId))
    .where(
      and(
        eq(studentEnrollments.locationId, locationId),
        eq(studentEnrollments.studentProfileId, studentProfileId),
        eq(studentEnrollments.status, 'active'),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export interface ProrationQuote {
  /** The month being split, as `YYYY-MM`. */
  period: string;
  daysInMonth: number;
  /** Days the leaving branch keeps: the 1st up to the day before the move. */
  daysBefore: number;
  /** Days the receiving branch bills: the move date to month end. */
  daysAfter: number;
  /** Open challans at the leaving branch covering this month. */
  challanIds: string[];
  monthlyTotal: string;
  credit: string;
  charge: string;
}

/**
 * Splits the month a transfer falls in between the two branches.
 *
 * ── The arithmetic, and why it is by day ────────────────────────────────
 * A parent moving a child on the 10th of a 30-day month has paid the old
 * campus for the whole month. The old campus keeps 9 days, the new one bills
 * 21. Rounding to half-months is the other common convention and is not used
 * here, because on the 10th it would round in the school's favour and a parent
 * checking the sum will notice.
 *
 * Only **open** challans are considered — the ones still owed. A challan
 * already paid in full is not clawed back automatically: refunding money that
 * has been banked is a decision with a receipt attached, and quietly issuing a
 * credit note against it is not something this should do without being asked.
 * That is recorded as a limitation rather than hidden: see the transfer route.
 *
 * A transfer on the 1st produces zero and zero, which is a real answer and is
 * why both columns are `not null default 0` rather than nullable.
 */
export async function quoteProration(
  locationId: string,
  studentProfileId: string,
  effectiveDate: string,
): Promise<ProrationQuote> {
  const date = new Date(`${effectiveDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new TransferError('That is not a date.');
  }

  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const daysBefore = day - 1;
  const daysAfter = daysInMonth - daysBefore;

  const open = await db
    .select({
      id: feeChallans.id,
      totalAmount: feeChallans.totalAmount,
      paidAmount: feeChallans.paidAmount,
    })
    .from(feeChallans)
    .where(
      and(
        eq(feeChallans.locationId, locationId),
        eq(feeChallans.studentProfileId, studentProfileId),
        eq(feeChallans.billingMonth, month),
        eq(feeChallans.billingYear, year),
        inArray(feeChallans.status, [...OPEN_CHALLAN_STATUSES]),
      ),
    );

  // Worked in integer paisa so a third of a rupee does not drift across the
  // two halves and leave the parent owing one paisa more than they were told.
  const totalPaisa = open.reduce(
    (sum, row) => sum + Math.round(Number(row.totalAmount) * 100),
    0,
  );

  /*
   * Credit and charge are the *same figure*, and that is not a mistake.
   *
   * They cover the same span — the days from the move to the end of the month.
   * The leaving branch gives that portion back; the receiving branch bills it.
   * The money moves between two branches of one school and the parent's total
   * for the month is unchanged, which is the property that makes a transfer
   * explicable at the counter.
   *
   * Stored as two columns rather than one because they are owed by and to
   * different branches, and a school running its campuses as separate cost
   * centres needs to see both sides. Rounded once and shared, so the halves
   * cannot fail to add back up to the month.
   */
  const sharePaisa =
    daysInMonth === 0 ? 0 : Math.round((totalPaisa * daysAfter) / daysInMonth);
  const creditPaisa = sharePaisa;
  const chargePaisa = sharePaisa;

  const money = (paisa: number) => (paisa / 100).toFixed(2);

  return {
    period: `${year}-${String(month).padStart(2, '0')}`,
    daysInMonth,
    daysBefore,
    daysAfter,
    challanIds: open.map((row) => row.id),
    monthlyTotal: money(totalPaisa),
    credit: money(creditPaisa),
    charge: money(chargePaisa),
  };
}

export interface TransferParams {
  locationId: string;
  actorUid: string;
  studentProfileId: string;
  toSectionId: string;
  effectiveDate: string;
  reason: string | null;
}

export interface TransferResult {
  transferId: string;
  fromBranchName: string;
  toBranchName: string;
  credit: string;
  charge: string;
  cancelledChallans: number;
}

/**
 * Carries out a transfer.
 *
 * One transaction: a student who has left one campus and not arrived at the
 * other is on nobody's register, and the register is taken every morning.
 *
 * The leaving branch's open challans for the transfer month are **cancelled**,
 * not edited. A challan is the record of what was demanded, frozen at
 * generation (see `fee_challans`); rewriting its total to a prorated figure
 * would make the printed slip a parent is holding disagree with the system.
 * The receiving branch bills the remainder on its own next challan run, and
 * `prorated_charge` on the transfer record is what that run is owed.
 */
export async function transferStudent(params: TransferParams): Promise<TransferResult> {
  const { locationId, actorUid, studentProfileId, toSectionId, effectiveDate } = params;

  const current = await getTransferCandidate(locationId, studentProfileId);
  if (current === null) {
    throw new TransferError('That student has no active enrolment to transfer.', 404);
  }

  const destinationRows = await db
    .select({
      sectionId: sections.id,
      academicYearId: sections.academicYearId,
      gradeId: grades.id,
      branchId: branches.id,
      branchName: branches.name,
    })
    .from(sections)
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .innerJoin(branches, eq(branches.id, grades.branchId))
    .where(and(eq(sections.locationId, locationId), eq(sections.id, toSectionId)))
    .limit(1);

  const destination = destinationRows[0];
  if (destination === undefined) {
    throw new TransferError('That class does not exist.');
  }

  if (destination.branchId === current.branchId) {
    throw new TransferError(
      'That class is at the same campus. Change their section from the student profile instead — a transfer is between branches.',
    );
  }

  if (destination.academicYearId !== current.academicYearId) {
    throw new TransferError(
      'That class is in a different academic year. Transfer within the year, then promote.',
    );
  }

  const quote = await quoteProration(locationId, studentProfileId, effectiveDate);

  const transferId = crypto.randomUUID();

  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(studentEnrollments)
      .values({
        locationId,
        studentProfileId,
        sectionId: toSectionId,
        academicYearId: current.academicYearId,
        status: 'active',
        enrollmentDate: effectiveDate,
      })
      .returning({ id: studentEnrollments.id });

    await tx
      .update(studentEnrollments)
      .set({ status: 'transferred' })
      .where(eq(studentEnrollments.id, current.enrollmentId));

    if (quote.challanIds.length > 0) {
      await tx
        .update(feeChallans)
        .set({
          status: 'cancelled',
          notes: `Cancelled on transfer to ${destination.branchName}, ${effectiveDate}.`,
          updatedAt: new Date(),
        })
        .where(inArray(feeChallans.id, quote.challanIds));
    }

    await tx.insert(studentTransfers).values({
      id: transferId,
      locationId,
      studentProfileId,
      academicYearId: current.academicYearId,
      fromBranchId: current.branchId,
      toBranchId: destination.branchId,
      fromSectionId: current.sectionId,
      toSectionId,
      fromEnrollmentId: current.enrollmentId,
      toEnrollmentId: inserted[0]?.id ?? null,
      effectiveDate,
      proratedCredit: quote.credit,
      proratedCharge: quote.charge,
      reason: params.reason,
      transferredByUid: actorUid,
    });
  });

  return {
    transferId,
    fromBranchName: current.branchName,
    toBranchName: destination.branchName,
    credit: quote.credit,
    charge: quote.charge,
    cancelledChallans: quote.challanIds.length,
  };
}

export interface TransferRecord {
  id: string;
  name: string;
  studentId: string;
  fromBranchName: string;
  toBranchName: string;
  effectiveDate: string;
  proratedCredit: string;
  proratedCharge: string;
  reason: string | null;
}

export async function listTransfers(
  locationId: string,
  limit = 50,
): Promise<TransferRecord[]> {
  // Aliased, because both joins are to `branches` and drizzle would otherwise
  // emit the same table name twice and the second join would silently win.
  const from = alias(branches, 'from_branch');
  const to = alias(branches, 'to_branch');

  return db
    .select({
      id: studentTransfers.id,
      name: schoolUsers.name,
      studentId: studentProfiles.studentId,
      fromBranchName: from.name,
      toBranchName: to.name,
      effectiveDate: studentTransfers.effectiveDate,
      proratedCredit: studentTransfers.proratedCredit,
      proratedCharge: studentTransfers.proratedCharge,
      reason: studentTransfers.reason,
    })
    .from(studentTransfers)
    .innerJoin(studentProfiles, eq(studentProfiles.id, studentTransfers.studentProfileId))
    .innerJoin(schoolUsers, eq(schoolUsers.id, studentProfiles.schoolUserId))
    .innerJoin(from, eq(from.id, studentTransfers.fromBranchId))
    .innerJoin(to, eq(to.id, studentTransfers.toBranchId))
    .where(eq(studentTransfers.locationId, locationId))
    .orderBy(desc(studentTransfers.createdAt))
    .limit(limit);
}
