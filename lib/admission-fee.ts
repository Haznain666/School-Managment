import 'server-only';

import { and, asc, eq, ne, sql } from 'drizzle-orm';

import {
  academicYears,
  feeChallanItems,
  feeChallans,
  feeStructures,
  feeTypes,
  grades,
  sections,
  studentEnrollments,
  gradeLabel,
} from '@/db/schema';

import { db } from './drizzle';
import { calculateChallanItems } from './fee-calculator';
import { listActiveConcessions, toDateOnly } from './fee-queries';

/**
 * "What does this child's admission fee actually say?" — resolved once, in one
 * place, for the panel on their profile.
 *
 * ── Why this file exists ─────────────────────────────────────────────────
 * `FeeClearancePanel` has been headed *Admission fee* since Sprint 10 and had
 * no connection whatsoever to the school's Admission Fee head. It asked one
 * question — has somebody ticked this enrollment as paid — and offered one
 * button, which sent the parents their portal welcome. A school that had never
 * priced its admission fee for a grade saw exactly the same panel as one that
 * had, and could confirm a payment against a price that did not exist.
 *
 * The panel is now driven by the fee structure, and this is the resolver. It
 * returns a discriminated union rather than a bag of booleans because the four
 * answers are genuinely four different things to say to an administrator, and
 * because the ordering rule the product owner asked for — **you cannot confirm
 * a payment for a fee that was never billed** — has to be visible in one
 * `switch` rather than trusted to a reader assembling three flags in their head.
 *
 * ── Naming, and the school that renamed its head ─────────────────────────
 * The head is found by name (`Admission Fee`, case-insensitively) and falls
 * back to the lowest `sort_order` `one_time` head. A school that calls it
 * "Registration Charges" keeps working; a school with no one-time head at all
 * gets `no_fee_head`, which is a real answer and not an error. After Sprint
 * 17's provisioning seed that state exists only for schools created before
 * this deploy.
 */

/** The one-time head a school bills admissions under. */
export interface AdmissionFeeHead {
  id: string;
  name: string;
}

/** The admission challan a student already holds. */
export interface AdmissionChallanRef {
  id: string;
  challanNumber: string;
  status: string;
  totalAmount: string;
  paidAmount: string;
  dueDate: string;
}

/** Where the student sits, which is what decides the price. */
export interface AdmissionPlacement {
  gradeId: string;
  gradeName: string;
  academicYearId: string;
  academicYearName: string;
  feeStatus: 'outstanding' | 'cleared';
}

/**
 * The four states of one student's admission fee.
 *
 * The invariant to preserve is that **`kind` alone decides whether a
 * confirm-payment control may render**: only `billed` and `settled` may. A fee
 * that has not been billed cannot have been paid, and offering the confirmation
 * before the voucher is what let a school mark an admission settled against a
 * price it had never set.
 */
export type AdmissionFeeState =
  /** No active enrollment. The panel does not render at all. */
  | { kind: 'not_enrolled' }
  /** The school has no one-time fee head to bill an admission under. */
  | { kind: 'no_fee_head'; placement: AdmissionPlacement }
  /** A head exists, but this grade has no price for it in this year. */
  | { kind: 'no_amount'; placement: AdmissionPlacement; head: AdmissionFeeHead }
  /** Priced — including a deliberate 0 — and not yet billed. */
  | {
      kind: 'not_billed';
      placement: AdmissionPlacement;
      head: AdmissionFeeHead;
      /** Gross PKR from the price list, before any concession. */
      amount: string;
      /** What the concessions in force today would take off it. */
      concessionAmount: string;
      /** amount − concession. What the voucher would demand. */
      netAmount: string;
    }
  /** Billed and still owing. */
  | {
      kind: 'billed';
      placement: AdmissionPlacement;
      head: AdmissionFeeHead;
      challan: AdmissionChallanRef;
    }
  /** Paid, waived, cancelled — or the enrollment was cleared by hand. */
  | {
      kind: 'settled';
      placement: AdmissionPlacement;
      head: AdmissionFeeHead | null;
      challan: AdmissionChallanRef | null;
    };

/**
 * Statuses that mean the admission fee is no longer owed.
 *
 * ── `cancelled` is deliberately NOT one of them ──────────────────────────
 * It was, and that was a defect QA caught by cancelling a voucher and finding
 * the student stranded: the panel reported the admission *settled*, offered
 * nothing, and there was no way anywhere in the product to raise a corrected
 * voucher. A cancelled bill is not a paid bill — it is a bill that was
 * withdrawn, usually because it was wrong, and the whole reason to withdraw one
 * is to issue another.
 *
 * The database already said so. `fee_challans_admission_once_idx` is partial on
 * `status <> 'cancelled'` precisely so that cancelling makes room for a
 * replacement, and `waived` is excluded from that predicate because a waiver
 * *is* a decision that settles the fee. This list and that predicate are two
 * statements of one rule, and they had drifted apart in the first version —
 * the screen refusing what the schema permitted.
 */
const CLOSED_CHALLAN_STATUSES: readonly string[] = ['paid', 'waived'];

/**
 * The student's active enrollment, with the grade and year that price it.
 *
 * Active specifically. A student who has left, or whose placement has not been
 * made, has no admission to charge for, and pricing one against their last
 * known grade would put a bill on a record nobody is looking at.
 */
async function resolvePlacement(
  locationId: string,
  studentProfileId: string,
): Promise<AdmissionPlacement | null> {
  const rows = await db
    .select({
      gradeId: sections.gradeId,
      gradeName: grades.name,
      gradeDisplayName: grades.displayName,
      academicYearId: studentEnrollments.academicYearId,
      academicYearName: academicYears.name,
      feeStatus: studentEnrollments.feeStatus,
    })
    .from(studentEnrollments)
    .innerJoin(sections, eq(sections.id, studentEnrollments.sectionId))
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .innerJoin(academicYears, eq(academicYears.id, studentEnrollments.academicYearId))
    .where(
      and(
        eq(studentEnrollments.locationId, locationId),
        eq(studentEnrollments.studentProfileId, studentProfileId),
        eq(studentEnrollments.status, 'active'),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (row === undefined) return null;

  return {
    gradeId: row.gradeId,
    gradeName: gradeLabel({ name: row.gradeName, displayName: row.gradeDisplayName }),
    academicYearId: row.academicYearId,
    academicYearName: row.academicYearName,
    feeStatus: row.feeStatus,
  };
}

/**
 * The school's one-time admission head, by name and then by position.
 *
 * `Admission Fee` case-insensitively is the exact match; the lowest-ordered
 * `one_time` head is the fallback. The fallback is deliberate rather than
 * charitable: `fee_category = 'one_time'` is what keeps a charge off every
 * monthly bill, so a school that has exactly one such head has already told us
 * which one the admission is, whatever it has chosen to call it.
 *
 * Inactive heads are excluded. A school that switched its admission fee off has
 * decided not to charge one, and the answer to that is the same red callout as
 * never having created it — not a voucher raised under a retired head.
 */
export async function resolveAdmissionFeeHead(
  locationId: string,
): Promise<AdmissionFeeHead | null> {
  const rows = await db
    .select({ id: feeTypes.id, name: feeTypes.name })
    .from(feeTypes)
    .where(
      and(
        eq(feeTypes.locationId, locationId),
        eq(feeTypes.feeCategory, 'one_time'),
        eq(feeTypes.isActive, true),
      ),
    )
    .orderBy(asc(feeTypes.sortOrder), asc(feeTypes.name));

  const named = rows.find((row) => row.name.trim().toLowerCase() === 'admission fee');
  return named ?? rows[0] ?? null;
}

/**
 * The challan carrying an admission line for this student, if there is one.
 *
 * Found through `fee_challan_items.fee_type_id` rather than through the billing
 * month, because an admission challan carries a null month by design and there
 * is nothing else on the header that says what it is for.
 *
 * ── Cancelled challans are excluded, and that is the fix ─────────────────
 * They used to be included, on the reasoning that a cancelled fee is settled.
 * QA cancelled a voucher and found the student stranded: the panel called the
 * admission `billed`, pointed at a withdrawn bill, and offered no way to raise
 * a corrected one.
 *
 * A withdrawn bill is not this student's admission voucher — it is the record
 * of one that was taken back. Excluding it here is what returns the panel to
 * `not_billed`, and it is the same rule
 * `fee_challans_admission_once_idx` states in its `status <> 'cancelled'`
 * predicate. One rule, and now only one place decides it.
 *
 * An *open* challan still outranks a closed one, so a school that cancelled a
 * voucher and raised a replacement sees the replacement.
 */
async function findAdmissionChallan(
  locationId: string,
  studentProfileId: string,
  feeTypeId: string,
): Promise<AdmissionChallanRef | null> {
  const rows = await db
    .select({
      id: feeChallans.id,
      challanNumber: feeChallans.challanNumber,
      status: feeChallans.status,
      totalAmount: feeChallans.totalAmount,
      paidAmount: feeChallans.paidAmount,
      dueDate: feeChallans.dueDate,
    })
    .from(feeChallans)
    .innerJoin(feeChallanItems, eq(feeChallanItems.challanId, feeChallans.id))
    .where(
      and(
        eq(feeChallans.locationId, locationId),
        eq(feeChallans.studentProfileId, studentProfileId),
        eq(feeChallanItems.feeTypeId, feeTypeId),
        ne(feeChallans.status, 'cancelled'),
      ),
    )
    // A raw template with no value in it — a CASE expression has no operator,
    // which is the one thing CLAUDE.md reserves `sql` for. Nothing user-supplied
    // reaches the driver here.
    .orderBy(
      sql`case when ${feeChallans.status} in ('unpaid', 'partial') then 0 else 1 end`,
      asc(feeChallans.createdAt),
    )
    .limit(1);

  return rows[0] ?? null;
}

/**
 * What the price list says this grade pays under the admission head, and what
 * the student's concessions would take off it.
 *
 * Returns null when there is no `fee_structures` row — which is exactly what
 * `no_amount` means. A stored `0` is a decision the school made and is *not*
 * null: it says "this grade pays no admission fee", and the voucher for it is a
 * legitimate zero-rupee voucher rather than a red callout. `PUT
 * /api/school/fees/structures` draws the same distinction, deleting the row for
 * a blank cell and storing `0.00` for a typed zero.
 */
async function findAdmissionPrice(
  locationId: string,
  studentProfileId: string,
  head: AdmissionFeeHead,
  placement: AdmissionPlacement,
): Promise<{ amount: string; concessionAmount: string; netAmount: string } | null> {
  const rows = await db
    .select({ amount: feeStructures.amount })
    .from(feeStructures)
    .where(
      and(
        eq(feeStructures.locationId, locationId),
        eq(feeStructures.feeTypeId, head.id),
        eq(feeStructures.gradeId, placement.gradeId),
        eq(feeStructures.academicYearId, placement.academicYearId),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (row === undefined) return null;

  // Priced against today, because that is when the voucher would be raised.
  // The generator re-prices against the challan's own due date; this figure is
  // what the panel promises, and the two agree on the day it is clicked.
  const concessions = await listActiveConcessions(
    locationId,
    studentProfileId,
    toDateOnly(new Date()),
  );

  const item = calculateChallanItems(
    [
      {
        feeTypeId: head.id,
        description: head.name,
        feeCategory: 'one_time',
        amount: row.amount,
      },
    ],
    concessions,
  )[0];

  return {
    amount: row.amount,
    concessionAmount: item?.concessionAmount ?? '0.00',
    netAmount: item?.netAmount ?? row.amount,
  };
}

/**
 * Everything the admission-fee panel needs, in one call.
 *
 * @param locationId  Tenant key, always from verified session claims.
 */
export async function resolveAdmissionFee(
  locationId: string,
  studentProfileId: string,
): Promise<AdmissionFeeState> {
  const placement = await resolvePlacement(locationId, studentProfileId);
  if (placement === null) return { kind: 'not_enrolled' };

  const head = await resolveAdmissionFeeHead(locationId);

  // The challan is looked up before the price, because a challan that exists is
  // the authority on what was demanded and the price list may since have moved.
  const challan =
    head === null
      ? null
      : await findAdmissionChallan(locationId, studentProfileId, head.id);

  if (challan !== null && CLOSED_CHALLAN_STATUSES.includes(challan.status)) {
    return { kind: 'settled', placement, head, challan };
  }

  /*
   * A hand-cleared enrollment is settled even with no challan behind it.
   *
   * `clearEnrolmentFee` exists for the school that takes cash across a desk and
   * never raises a voucher, and that decision has already sent the guardians
   * their portal welcome. Offering to bill them afterwards would be offering to
   * bill a fee somebody has told us in writing was paid.
   */
  if (placement.feeStatus === 'cleared') {
    return { kind: 'settled', placement, head, challan };
  }

  if (head !== null && challan !== null) {
    return { kind: 'billed', placement, head, challan };
  }

  if (head === null) return { kind: 'no_fee_head', placement };

  const price = await findAdmissionPrice(locationId, studentProfileId, head, placement);
  if (price === null) return { kind: 'no_amount', placement, head };

  return {
    kind: 'not_billed',
    placement,
    head,
    amount: price.amount,
    concessionAmount: price.concessionAmount,
    netAmount: price.netAmount,
  };
}
