import 'server-only';

import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import {
  concessionSchemes,
  feeTypes,
  schoolUsers,
  studentConcessionFeeTypes,
  studentConcessions,
  studentProfiles,
  type ChallanStatus,
  type DiscountType,
  type SchemeType,
} from '@/db/schema';

import { listConcessionSchemes } from './concession-schemes';
import { db } from './drizzle';
import { repriceOpenChallans } from './fee-challans';
import { toDateOnly } from './fee-queries';
import {
  closingDate,
  siblingPolicyFor,
  siblingStandingFor,
  siblingStandingForNewChild,
  type SiblingStanding,
} from './sibling-discounts';

/**
 * Everything the Apply-discount panel needs, for one child (Sprint 20, item 7).
 *
 * ── One reader for two screens ───────────────────────────────────────────
 * `components/fees/StudentDiscountPanel.tsx` is used from the enrollment wizard
 * — where the child does not exist yet and the family is known only from the
 * guardian rows a clerk has typed — and from the student profile, where they
 * do. Both ask this module, so the two screens cannot come to disagree about
 * who qualifies for what; the only difference between them is which of the two
 * entry points below is called.
 *
 * ── A grant freezes; a scheme does not ───────────────────────────────────
 * Applying writes an ordinary `student_concessions` row through
 * `applySchemeToStudents`, which copies the scheme's name, rate, dates and fee
 * heads onto it. **There is no second grant path**, deliberately: a second one
 * would be a second place for the freezing rule to be forgotten, and the
 * symptom would be a discount that silently re-prices itself when a school
 * edits a scheme in March.
 *
 * ── Removal is a `valid_until`, never a `DELETE` ─────────────────────────
 * `closeStudentConcession` dates the grant closed and reprices what is still
 * open. The row stays, so the vouchers it already discounted stay explainable —
 * the same reasoning the append-only ledger rests on, and the same rule the
 * automatic sweep in `lib/sibling-discounts.ts` follows.
 */

/** One scheme the operator may pick in the modal. */
export interface DiscountSchemeOption {
  id: string;
  name: string;
  schemeType: SchemeType;
  discountType: DiscountType;
  discountValue: string;
  /** Empty means **every fee head, of every category**. */
  feeTypeNames: string[];
  /** True when this child already holds a grant from this scheme. */
  alreadyGranted: boolean;
}

/** One discount this child holds. */
export interface DiscountGrantRow {
  id: string;
  concessionName: string;
  discountType: DiscountType;
  discountValue: string;
  validFrom: string;
  validUntil: string | null;
  schemeId: string | null;
  /** Null for a grant typed in by hand, or one whose scheme has been deleted. */
  schemeType: SchemeType | null;
  feeTypeNames: string[];
  /** Whether it is still in force today. A closed grant is history, not a chip. */
  isOpen: boolean;
}

export interface StudentDiscountState {
  /** Null in the wizard, where the child does not exist yet. */
  studentProfileId: string | null;
  studentName: string;
  grants: DiscountGrantRow[];
  schemes: DiscountSchemeOption[];
  sibling: SiblingStanding;
  /** Whether the school grants the sibling discount without being asked. */
  autoApply: boolean;
}

/** Every active scheme this caller may offer, with its heads. */
async function schemeOptions(
  locationId: string,
  branchIds: string[] | null,
  grantedSchemeIds: ReadonlySet<string>,
): Promise<DiscountSchemeOption[]> {
  const schemes = await listConcessionSchemes(locationId, branchIds);

  return schemes
    // Active only. A scheme a school has switched off is one it has stopped
    // offering, and putting it in a picker is how it starts being granted
    // again by somebody who did not know it had been withdrawn.
    .filter((scheme) => scheme.isActive)
    .map((scheme) => ({
      id: scheme.id,
      name: scheme.name,
      schemeType: scheme.schemeType,
      discountType: scheme.discountType,
      discountValue: scheme.discountValue,
      feeTypeNames: scheme.feeTypeNames,
      alreadyGranted: grantedSchemeIds.has(scheme.id),
    }));
}

/** This child's grants, newest first, with the scheme each came from. */
async function grantsFor(
  locationId: string,
  studentProfileId: string,
  today: string,
): Promise<DiscountGrantRow[]> {
  const rows = await db
    .select({
      id: studentConcessions.id,
      concessionName: studentConcessions.concessionName,
      discountType: studentConcessions.discountType,
      discountValue: studentConcessions.discountValue,
      validFrom: studentConcessions.validFrom,
      validUntil: studentConcessions.validUntil,
      schemeId: studentConcessions.schemeId,
      // A LEFT join: `scheme_id` is `ON DELETE SET NULL`, so a grant outlives
      // the policy it came from and must still render.
      schemeType: concessionSchemes.schemeType,
    })
    .from(studentConcessions)
    .leftJoin(concessionSchemes, eq(concessionSchemes.id, studentConcessions.schemeId))
    .where(
      and(
        eq(studentConcessions.locationId, locationId),
        eq(studentConcessions.studentProfileId, studentProfileId),
      ),
    )
    .orderBy(desc(studentConcessions.validFrom), desc(studentConcessions.createdAt));

  if (rows.length === 0) return [];

  const heads = await db
    .select({
      studentConcessionId: studentConcessionFeeTypes.studentConcessionId,
      feeTypeName: feeTypes.name,
    })
    .from(studentConcessionFeeTypes)
    .innerJoin(feeTypes, eq(feeTypes.id, studentConcessionFeeTypes.feeTypeId))
    .where(
      inArray(
        studentConcessionFeeTypes.studentConcessionId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(feeTypes.sortOrder), asc(feeTypes.name));

  return rows.map((row) => ({
    ...row,
    feeTypeNames: heads
      .filter((head) => head.studentConcessionId === row.id)
      .map((head) => head.feeTypeName),
    // The same window test the calculator applies, so a chip on the screen and
    // a discount on a voucher cannot disagree about what is in force.
    isOpen: row.validFrom <= today && (row.validUntil === null || row.validUntil >= today),
  }));
}

/** The panel's state for an enrolled child. */
export async function getStudentDiscountState(
  locationId: string,
  studentProfileId: string,
  branchIds: string[] | null = null,
): Promise<StudentDiscountState | null> {
  const today = toDateOnly(new Date());

  const named = await db
    .select({ name: schoolUsers.name })
    .from(studentProfiles)
    .innerJoin(schoolUsers, eq(schoolUsers.id, studentProfiles.schoolUserId))
    .where(
      and(
        eq(studentProfiles.id, studentProfileId),
        eq(studentProfiles.locationId, locationId),
      ),
    )
    .limit(1);

  const student = named[0];
  if (student === undefined) return null;

  const [grants, sibling, policy] = await Promise.all([
    grantsFor(locationId, studentProfileId, today),
    siblingStandingFor(locationId, studentProfileId),
    siblingPolicyFor(locationId),
  ]);

  const held = new Set(
    grants
      .filter((grant) => grant.isOpen && grant.schemeId !== null)
      .map((grant) => grant.schemeId!),
  );

  return {
    studentProfileId,
    studentName: student.name,
    grants,
    schemes: await schemeOptions(locationId, branchIds, held),
    sibling,
    autoApply: policy.autoApply,
  };
}

/**
 * The panel's state for a child being enrolled, who has no row yet.
 *
 * The family is resolved from the guardian identities the clerk has typed —
 * the same CNIC-or-phone rule `lib/siblings.ts` applies everywhere else — so
 * the wizard's answer and the profile's answer come from one place and one
 * rule.
 */
export async function getNewChildDiscountState(
  locationId: string,
  studentName: string,
  identities: readonly { cnic: string | null; phone: string | null }[],
  branchIds: string[] | null = null,
): Promise<StudentDiscountState> {
  const [sibling, policy] = await Promise.all([
    siblingStandingForNewChild(locationId, identities),
    siblingPolicyFor(locationId),
  ]);

  return {
    studentProfileId: null,
    studentName,
    grants: [],
    schemes: await schemeOptions(locationId, branchIds, new Set()),
    sibling,
    autoApply: policy.autoApply,
  };
}

/**
 * The statuses a *removal* may reprice — vouchers with no money against them.
 *
 * Deliberately **not** `OPEN_CHALLAN_STATUSES`, and deliberately not a
 * narrowing of it. That constant means "still owed" and eight other modules
 * read it that way: the defaulters list, the family voucher, the enrolment fee
 * gate, the transfer clearance. Narrowing it to make one call site behave would
 * change what a defaulter is. This is a different question — *has any money
 * been handed over* — asked in one place, and so it lives here beside the
 * caller that asks it.
 */
const PAYMENT_FREE_STATUSES: readonly ChallanStatus[] = ['unpaid'];

export class StudentDiscountError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'StudentDiscountError';
    this.code = code;
    this.status = status;
  }
}

/**
 * Closes one grant, and reprices what the child still owes.
 *
 * ── A `valid_until`, never a `DELETE` ────────────────────────────────────
 * The row stays. `student_concessions` closes a grant by dating it, so the
 * vouchers it already discounted remain explainable — a parent asking in March
 * why February's slip was 4,000 lower gets an answer instead of a shrug. The
 * existing `DELETE /api/school/fees/concessions/[id]` is untouched and keeps
 * its own narrower job: a grant entered in error, against the wrong child or
 * for the wrong amount, which never should have existed at all.
 *
 * The close date is **yesterday**, clamped so it never precedes `valid_from`,
 * so the grant stops applying to anything billed from today.
 *
 * ── Removal is a correction, not the passage of time (Sprint 23, item 1) ──
 * Until this sprint the sentence here read *"a voucher already issued keeps
 * its discount, which is right: it was raised for a period the child held the
 * grant in"*, and the reprice below silently did nothing. That reasoning is
 * correct for a grant that simply **expires** — its `valid_until` passes on
 * its own — and wrong for one an operator is taking off because it should
 * never have been given.
 *
 * The two are separated by the arguments, not by a new function:
 *
 *  * `priceAsOf: 'today'` — the grant is looked up as at now, after the
 *    `valid_until` above has been written, so it is genuinely gone. Under the
 *    default rule a voucher due on the 10th, corrected on the 27th, would be
 *    priced as at the 10th and keep its discount;
 *  * `statuses: ['unpaid']` — a voucher with **any** money against it is left
 *    exactly like a settled one. That money is in the school's drawer and the
 *    parent is holding a receipt for a figure this would move underneath them.
 *
 * A grant that expires naturally still passes through neither of these: the
 * sweep in `lib/sibling-discounts.ts` calls `repriceOpenChallans` with its
 * defaults, so issued vouchers stay as they were. That behaviour is the one
 * §5bj called correct and it is untouched.
 *
 * **Nothing here touches the ledger, and nothing may.** A voucher with no
 * payment has posted no transaction, which is exactly why repricing one is
 * safe under CLAUDE.md's append-only rule — there is nothing to reverse.
 */
export async function closeStudentConcession(params: {
  locationId: string;
  studentProfileId: string;
  concessionId: string;
  actorUid: string;
}): Promise<{
  repricedVouchers: number;
  /** Vouchers left alone because money is recorded against them, by number. */
  paidVouchers: string[];
  /** Everything else that was skipped, with its reason. Family vouchers, mostly. */
  skipped: Array<{ challanNumber: string; reason: string }>;
}> {
  const { locationId, studentProfileId, concessionId, actorUid } = params;
  const today = toDateOnly(new Date());

  const existing = await db
    .select({
      id: studentConcessions.id,
      validFrom: studentConcessions.validFrom,
      notes: studentConcessions.notes,
    })
    .from(studentConcessions)
    .where(
      and(
        eq(studentConcessions.id, concessionId),
        eq(studentConcessions.locationId, locationId),
        // Re-read against the student in the URL rather than trusted from the
        // body: an id from another child of the same school must not be closed
        // through a panel that is about this one.
        eq(studentConcessions.studentProfileId, studentProfileId),
      ),
    )
    .limit(1);

  const grant = existing[0];
  if (grant === undefined) {
    throw new StudentDiscountError(
      'not_found',
      'That discount is not on this student’s record.',
      404,
    );
  }

  const note =
    `Removed on ${today} from the student’s discount panel.` +
    (grant.notes === null || grant.notes.trim() === '' ? '' : `\n\n${grant.notes}`);

  await db
    .update(studentConcessions)
    .set({ validUntil: closingDate(today, grant.validFrom), notes: note })
    .where(eq(studentConcessions.id, concessionId));

  /*
   * Awaited, not fired and forgotten. The response tells the clerk which
   * vouchers moved, and "it did not reach this month's voucher" is precisely
   * what they need to read while they are still on the screen — the same
   * argument `POST /api/school/fees/concessions` makes about granting one.
   */
  const reprice = await repriceOpenChallans(db, {
    locationId,
    studentProfileId,
    actorUid,
    // The two arguments that are the whole of Sprint 23 item 1. See the
    // docblock above for why removal is not the passage of time.
    priceAsOf: 'today',
    statuses: PAYMENT_FREE_STATUSES,
  });

  /*
   * Split by reason rather than returned as one list.
   *
   * "n left unchanged because a payment has been recorded against them" is the
   * sentence that stops a half-correction looking like a whole one, and it is
   * a different sentence from "it is on a family voucher". The panel renders
   * both; collapsing them into one count would let the family-voucher case
   * silently pad the number that matters.
   */
  const paidReason = 'A payment has been recorded against it.';

  return {
    repricedVouchers: reprice.repriced.length,
    paidVouchers: reprice.skipped
      .filter((row) => row.reason === paidReason)
      .map((row) => row.challanNumber),
    skipped: reprice.skipped.filter((row) => row.reason !== paidReason),
  };
}
