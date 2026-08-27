import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';

import {
  feeChallanItems,
  feeChallans,
  feeTypes,
  grades,
  schoolUsers,
  schools,
  sections,
  studentCredits,
  studentEnrollments,
  studentProfiles,
  gradeLabel,
  OPEN_CHALLAN_STATUSES,
} from '@/db/schema';

import { resolveAdmissionFee } from './admission-fee';
import { generateChallanNumber, reserveChallanNumbers } from './challan-number';
import { batch, type Database, type Tx } from './drizzle';
import {
  applyCreditToTotals,
  calculateChallanLines,
  defaultDueDate,
  summariseChallanItems,
  type ChallanItem,
  type ChallanTotals,
} from './fee-calculator';
import {
  getCreditBalancePaise,
  getDueDay,
  listActiveConcessions,
  listActiveConcessionsForStudents,
  listBillableStructures,
  toDateOnly,
} from './fee-queries';
import { paiseToNumeric, toPaise } from './money';

/**
 * Challan generation (Sprint 5).
 *
 * ── On atomicity ─────────────────────────────────────────────────────────
 * A challan is a header plus its lines, and a header with no lines is a bill
 * for an unexplained amount — worse than no bill. The two writes therefore go
 * out through `batch()`, which runs them in one Postgres transaction. That is
 * also why bulk generation opens a transaction *per student* rather than per
 * run: one student's bad data must not roll back the four hundred challans
 * already raised beside it.
 *
 * Numbers are reserved before the writes, from the atomic counter in
 * `lib/challan-number.ts`. A reserved number whose insert then fails is simply
 * burnt — a gap in the sequence is harmless, a collision is not.
 */

/** Raised when a challan cannot be generated. Blocks generation — it must. */
export class ChallanGenerationError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'ChallanGenerationError';
    this.code = code;
    this.status = status;
  }
}

export interface ChallanPreview extends ChallanTotals {
  /** Discount the lines could not absorb; banked as a credit on generation. */
  overflowPaise: number;
  studentProfileId: string;
  studentName: string;
  studentId: string;
  gradeId: string;
  gradeName: string;
  sectionName: string;
  dueDate: string;
}

/** A student's placement in one academic year, which is what sets their price. */
interface Placement {
  studentProfileId: string;
  studentName: string;
  studentId: string;
  gradeId: string;
  gradeName: string;
  sectionName: string;
}

async function getPlacement(
  db: Database,
  locationId: string,
  studentProfileId: string,
  academicYearId: string,
): Promise<Placement | null> {
  const rows = await db
    .select({
      studentProfileId: studentProfiles.id,
      studentName: schoolUsers.name,
      studentId: studentProfiles.studentId,
      gradeId: sections.gradeId,
      gradeName: grades.name,
      gradeDisplayName: grades.displayName,
      sectionName: sections.name,
    })
    .from(studentEnrollments)
    .innerJoin(
      studentProfiles,
      eq(studentProfiles.id, studentEnrollments.studentProfileId),
    )
    .innerJoin(schoolUsers, eq(schoolUsers.id, studentProfiles.schoolUserId))
    .innerJoin(sections, eq(sections.id, studentEnrollments.sectionId))
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .where(
      and(
        eq(studentEnrollments.locationId, locationId),
        eq(studentEnrollments.studentProfileId, studentProfileId),
        eq(studentEnrollments.academicYearId, academicYearId),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (row === undefined) return null;

  return {
    studentProfileId: row.studentProfileId,
    studentName: row.studentName,
    studentId: row.studentId,
    gradeId: row.gradeId,
    gradeName: gradeLabel({ name: row.gradeName, displayName: row.gradeDisplayName }),
    sectionName: row.sectionName,
  };
}

/** The school code that prefixes every challan number. */
async function getSchoolCode(db: Database, locationId: string): Promise<string> {
  const rows = await db
    .select({ schoolCode: schools.schoolCode })
    .from(schools)
    .where(and(eq(schools.locationId, locationId), eq(schools.isActive, true)))
    .limit(1);

  const code = rows[0]?.schoolCode ?? '';
  if (code === '') {
    throw new ChallanGenerationError(
      'no_school_code',
      'This school has no school code set. Add one in the Super Admin panel before generating challans.',
      409,
    );
  }

  return code;
}

/**
 * The statement that spends a student's credit on a challan, or nothing.
 *
 * Built on `tx` and returned rather than executed, so the caller can splice it
 * into the same `batch()` as the challan header and lines. A builder made from
 * `db` would run outside the transaction even when awaited inside one, and the
 * one thing this row must never do is commit separately from the challan that
 * spent it.
 *
 * The consumption is a *negative* row rather than an update of the granting
 * one: `student_credits` is append-only, in the same sense the ledger is, and a
 * balance is `SUM(amount)`.
 */
function consumeCreditStatements(
  tx: Tx,
  params: {
    locationId: string;
    studentProfileId: string;
    challanId: string;
    creditApplied: string;
    actorUid: string | null;
  },
): PromiseLike<unknown>[] {
  const appliedPaise = toPaise(params.creditApplied);
  if (appliedPaise <= 0) return [];

  return [
    tx.insert(studentCredits).values({
      locationId: params.locationId,
      studentProfileId: params.studentProfileId,
      amount: paiseToNumeric(-appliedPaise),
      reason: 'applied_to_challan',
      appliedChallanId: params.challanId,
      createdByUid: params.actorUid,
    }),
  ];
}

/**
 * The statement that banks discount the lines could not absorb, or nothing.
 *
 * Same transaction discipline as `consumeCreditStatements`, and for the sharper
 * reason: this row *is* the money. A discount of 60,000 against a 50,000 fee
 * floors the voucher at zero and the remaining 10,000 exists nowhere else — if
 * this insert does not commit with the challan that clamped it, the school has
 * granted relief the product has quietly forgotten.
 */
function grantOverflowStatements(
  tx: Tx,
  params: {
    locationId: string;
    studentProfileId: string;
    challanId: string;
    overflowPaise: number;
    actorUid: string | null;
  },
): PromiseLike<unknown>[] {
  if (params.overflowPaise <= 0) return [];

  return [
    tx.insert(studentCredits).values({
      locationId: params.locationId,
      studentProfileId: params.studentProfileId,
      amount: paiseToNumeric(params.overflowPaise),
      reason: 'discount_overflow',
      sourceChallanId: params.challanId,
      notes: 'Discount exceeded the fee it was granted against.',
      createdByUid: params.actorUid,
    }),
  ];
}

export interface PreviewParams {
  locationId: string;
  studentProfileId: string;
  academicYearId: string;
  billingMonth: number;
  billingYear: number;
  dueDate?: string | undefined;
  /**
   * Day of the month challans fall due. Read from the school's own settings
   * when omitted, so a caller cannot accidentally bill against the platform
   * default when the school has chosen the 5th.
   */
  dueDay?: number | undefined;
}

/**
 * What a challan *would* say, without writing anything.
 *
 * The generation screen renders this, and the POST endpoint recomputes it
 * rather than trusting what the browser sends back — a preview is a courtesy,
 * not an input.
 */
export async function previewChallan(
  db: Database,
  params: PreviewParams,
): Promise<ChallanPreview> {
  const placement = await getPlacement(
    db,
    params.locationId,
    params.studentProfileId,
    params.academicYearId,
  );

  if (placement === null) {
    throw new ChallanGenerationError(
      'not_enrolled',
      'This student has no enrolment in the selected academic year, so there is no class to price their fees from.',
      409,
    );
  }

  const dueDate =
    params.dueDate ??
    defaultDueDate(
      params.billingMonth,
      params.billingYear,
      params.dueDay ?? (await getDueDay(params.locationId)),
    );

  const [structures, concessions] = await Promise.all([
    listBillableStructures(params.locationId, placement.gradeId, params.academicYearId),
    // Priced against the due date, so regenerating an old month applies the
    // concessions that were in force then rather than today's.
    listActiveConcessions(params.locationId, params.studentProfileId, dueDate),
  ]);

  if (structures.length === 0) {
    throw new ChallanGenerationError(
      'no_fee_structure',
      `No fee structure is set up for ${placement.gradeName} in this academic year. Add one before generating challans.`,
      409,
    );
  }

  const { items, overflowPaise } = calculateChallanLines(
    structures,
    concessions,
    params.billingMonth,
  );

  if (items.length === 0) {
    throw new ChallanGenerationError(
      'no_monthly_fees',
      `${placement.gradeName} has no monthly fee heads priced for this year, so a monthly challan would be empty.`,
      409,
    );
  }

  // Credit carried forward is the last thing applied, after the lines are
  // priced and summed. It is not a discount on a fee head — it is money the
  // school already owes this child from a discount granted too late to change
  // the challan it should have reduced — so it comes off the header, and the
  // preview shows it for the same reason the printed slip does.
  const creditPaise = await getCreditBalancePaise(
    params.locationId,
    params.studentProfileId,
  );

  return {
    ...applyCreditToTotals(summariseChallanItems(items), creditPaise),
    overflowPaise,
    studentProfileId: placement.studentProfileId,
    studentName: placement.studentName,
    studentId: placement.studentId,
    gradeId: placement.gradeId,
    gradeName: placement.gradeName,
    sectionName: placement.sectionName,
    dueDate,
  };
}

export interface GenerateChallanParams extends PreviewParams {
  actorUid: string;
  notes?: string | null | undefined;
}

export interface GeneratedChallan {
  id: string;
  challanNumber: string;
  studentProfileId: string;
  studentName: string;
  /** Credit carried forward that this challan spent. `0.00` when there was none. */
  creditApplied: string;
  totalAmount: string;
  dueDate: string;
  items: ChallanItem[];
}

/**
 * Raises one challan: header and lines, in a single transaction.
 *
 * @throws {ChallanGenerationError} when the student is not enrolled, the grade
 *   has no price list, or a challan for this period already exists.
 */
export async function generateChallan(
  db: Database,
  params: GenerateChallanParams,
): Promise<GeneratedChallan> {
  const preview = await previewChallan(db, params);

  const existing = await db
    .select({ challanNumber: feeChallans.challanNumber })
    .from(feeChallans)
    .where(
      and(
        eq(feeChallans.locationId, params.locationId),
        eq(feeChallans.studentProfileId, params.studentProfileId),
        eq(feeChallans.academicYearId, params.academicYearId),
        eq(feeChallans.billingMonth, params.billingMonth),
        eq(feeChallans.billingYear, params.billingYear),
      ),
    )
    .limit(1);

  if (existing[0] !== undefined) {
    throw new ChallanGenerationError(
      'already_exists',
      `${preview.studentName} already has challan ${existing[0].challanNumber} for this month.`,
      409,
    );
  }

  const schoolCode = await getSchoolCode(db, params.locationId);
  const challanNumber = await generateChallanNumber(
    db,
    params.locationId,
    schoolCode,
    params.billingMonth,
    params.billingYear,
  );

  const challanId = crypto.randomUUID();

  await batch(db, (tx) => [
    tx.insert(feeChallans).values({
      id: challanId,
      locationId: params.locationId,
      studentProfileId: params.studentProfileId,
      academicYearId: params.academicYearId,
      challanNumber,
      billingMonth: params.billingMonth,
      billingYear: params.billingYear,
      dueDate: preview.dueDate,
      subtotal: preview.subtotal,
      concessionAmount: preview.concessionAmount,
      creditApplied: preview.creditApplied,
      totalAmount: preview.totalAmount,
      status: 'unpaid',
      notes: params.notes ?? null,
      generatedByUid: params.actorUid,
    }),
    ...preview.items.map((item) =>
      tx.insert(feeChallanItems).values({
        locationId: params.locationId,
        challanId,
        feeTypeId: item.feeTypeId,
        description: item.description,
        amount: item.amount,
        concessionAmount: item.concessionAmount,
        netAmount: item.netAmount,
        // Frozen with the line, like `description`. A scheme renamed in March
        // must not rewrite what February's slip said it was.
        concessionDetail: item.concessionDetail,
      }),
    ),
    // Inside the same transaction as the challan, never after it. A credit
    // spent by a challan that was then not written is a credit lost, and
    // nothing on any screen would ever report it missing — the parent would
    // simply be billed twice for money the school already owed them.
    ...consumeCreditStatements(tx, {
      locationId: params.locationId,
      studentProfileId: params.studentProfileId,
      challanId,
      creditApplied: preview.creditApplied,
      actorUid: params.actorUid,
    }),
    ...grantOverflowStatements(tx, {
      locationId: params.locationId,
      studentProfileId: params.studentProfileId,
      challanId,
      overflowPaise: preview.overflowPaise,
      actorUid: params.actorUid,
    }),
  ]);

  return {
    id: challanId,
    challanNumber,
    studentProfileId: params.studentProfileId,
    studentName: preview.studentName,
    creditApplied: preview.creditApplied,
    totalAmount: preview.totalAmount,
    dueDate: preview.dueDate,
    items: preview.items,
  };
}

export interface GenerateAdmissionChallanParams {
  locationId: string;
  studentProfileId: string;
  actorUid: string;
  /** Defaults to the school's own due day, applied to the current month. */
  dueDate?: string | undefined;
  notes?: string | null | undefined;
}

/**
 * Raises the voucher for one student's admission fee.
 *
 * `generateChallan` with three deliberate differences, each of which is a fact
 * about what an admission fee *is* rather than a convenience:
 *
 *  1. **`billing_month` and `billing_year` are null.** An admission is not a
 *     period; it happens once. The unique index is on (student, month, year,
 *     academic year) and Postgres treats nulls as distinct, so this can never
 *     collide with the monthly challan for the same student — which is the
 *     whole reason it is safe to leave them null rather than stamping today's
 *     month on a charge that has nothing to do with today's month.
 *
 *  2. **Only the resolved admission head is billed.** `calculateChallanLines`
 *     is given that one structure row and no `billingMonth`, so its monthly
 *     filter does not run and nothing else on the price list comes with it. A
 *     school raising an admission voucher must not accidentally bill a year's
 *     library fee alongside it.
 *
 *  3. **One admission, one admission fee.** `resolveAdmissionFee` already
 *     reporting `billed` or `settled` is refused with `already_exists`. The
 *     check is a read rather than a constraint because the constraint cannot
 *     be written — null months are distinct, which is what makes (1) work.
 *
 * Everything else — the reserved number, `batch()`, `ChallanGenerationError`,
 * the credit consumed in the same transaction — is exactly `generateChallan`'s
 * and stays that way.
 *
 * The challan number comes from the **current** month and year, not the billing
 * period, because that counter's key is the issuing period: `GVS-2026-08-0041`
 * is the forty-first slip this school issued in August, and an admission
 * voucher issued in August is one of them.
 */
export async function generateAdmissionChallan(
  db: Database,
  params: GenerateAdmissionChallanParams,
): Promise<GeneratedChallan> {
  const state = await resolveAdmissionFee(params.locationId, params.studentProfileId);

  switch (state.kind) {
    case 'not_enrolled':
      throw new ChallanGenerationError(
        'not_enrolled',
        'This student has no active enrolment, so there is no class to price their admission fee from.',
        409,
      );
    case 'no_fee_head':
      throw new ChallanGenerationError(
        'no_fee_head',
        'This school has no active one-time fee head to bill an admission under. Add an Admission Fee on the fee types screen.',
        409,
      );
    case 'no_amount':
      throw new ChallanGenerationError(
        'no_fee_structure',
        `${state.head.name} has no amount set for ${state.placement.gradeName} in ${state.placement.academicYearName}. Set one — including a deliberate 0 — before raising the voucher.`,
        409,
      );
    case 'billed':
    case 'settled':
      throw new ChallanGenerationError(
        'already_exists',
        state.challan === null
          ? 'This admission has already been confirmed as paid, so there is nothing to bill.'
          : `This admission has already been billed on challan ${state.challan.challanNumber}.`,
        409,
      );
    case 'not_billed':
      break;
  }

  const placement = state.placement;
  const dueDate = params.dueDate ?? (await admissionDueDate(params.locationId));

  /*
   * Re-priced server-side rather than trusting the figure the panel showed — a
   * preview is a courtesy, not an input, and a tab left open across a
   * concession change must not bill yesterday's discount.
   *
   * ── Anchored on today, not on the due date ─────────────────────────────
   * A monthly challan is priced against its due date because it *is* the bill
   * for that period, and regenerating an old month must apply the concessions
   * that were in force then. An admission voucher has no period: it is raised
   * now, so the discount in force now is the one that applies. That is also
   * the product owner's rule stated directly — a discount is effective as long
   * as the fee has not been paid.
   *
   * This was a real defect. `admissionDueDate` used to stamp the school's due
   * day onto the *current* month, so a voucher raised on the 27th fell due on
   * the 10th — seventeen days in the past. Pricing against that date then
   * silently dropped every concession that began after it, which is exactly
   * the "my sibling discount did not apply" fault this sprint set out to fix,
   * resurfacing through a new route. The due date is now never in the past,
   * and the anchor no longer depends on it.
   *
   * `findAdmissionPrice` in `lib/admission-fee.ts` uses the same anchor, so the
   * figure the panel promises and the figure the voucher bills cannot diverge.
   */
  const concessions = await listActiveConcessions(
    params.locationId,
    params.studentProfileId,
    toDateOnly(new Date()),
  );

  const { items, overflowPaise } = calculateChallanLines(
    [
      {
        feeTypeId: state.head.id,
        description: state.head.name,
        feeCategory: 'one_time',
        amount: state.amount,
      },
    ],
    concessions,
  );

  const studentName = await getStudentName(db, params.locationId, params.studentProfileId);
  const totals = applyCreditToTotals(
    summariseChallanItems(items),
    await getCreditBalancePaise(params.locationId, params.studentProfileId),
  );

  const schoolCode = await getSchoolCode(db, params.locationId);
  const issuedAt = new Date();
  const challanNumber = await generateChallanNumber(
    db,
    params.locationId,
    schoolCode,
    issuedAt.getMonth() + 1,
    issuedAt.getFullYear(),
  );

  const challanId = crypto.randomUUID();

  const writeVoucher = (): Promise<unknown> =>
    batch(db, (tx) => [
      tx.insert(feeChallans).values({
        id: challanId,
        locationId: params.locationId,
        studentProfileId: params.studentProfileId,
        academicYearId: placement.academicYearId,
        challanNumber,
        billingMonth: null,
        billingYear: null,
        // What `fee_challans_admission_once_idx` is partial on. Without it this
        // row is an ordinary one-off challan, the index does not see it, and the
        // `already_exists` read above is the only guard again — which is no guard
        // at all against a second request already in flight.
        challanKind: 'admission',
        dueDate,
        subtotal: totals.subtotal,
        concessionAmount: totals.concessionAmount,
        creditApplied: totals.creditApplied,
        totalAmount: totals.totalAmount,
        status: 'unpaid',
        notes: params.notes ?? null,
        generatedByUid: params.actorUid,
      }),
      ...totals.items.map((item) =>
        tx.insert(feeChallanItems).values({
          locationId: params.locationId,
          challanId,
          feeTypeId: item.feeTypeId,
          description: item.description,
          amount: item.amount,
          concessionAmount: item.concessionAmount,
          netAmount: item.netAmount,
          concessionDetail: item.concessionDetail,
        }),
      ),
      ...consumeCreditStatements(tx, {
        locationId: params.locationId,
        studentProfileId: params.studentProfileId,
        challanId,
        creditApplied: totals.creditApplied,
        actorUid: params.actorUid,
      }),
      ...grantOverflowStatements(tx, {
        locationId: params.locationId,
        studentProfileId: params.studentProfileId,
        challanId,
        overflowPaise,
        actorUid: params.actorUid,
      }),
    ]);

  /*
   * The `already_exists` read above said there was no voucher; the index is
   * what makes that answer true. A second request that got past the same read
   * lands here, and losing that race must read as "somebody else already did
   * it" rather than as a server fault — the school's outcome is identical
   * either way, and the row the winner wrote is what the panel shows on
   * refresh.
   *
   * Narrowed by constraint name, not by SQLSTATE alone: `23505` on this insert
   * has two possible causes, and a collision on the challan *number* is a
   * different fault with a different remedy.
   */
  try {
    await writeVoucher();
  } catch (error) {
    if (isAdmissionRaceViolation(error)) {
      throw new ChallanGenerationError(
        'already_exists',
        'This admission has just been billed by somebody else. Refresh to see the voucher.',
        409,
      );
    }
    throw error;
  }

  return {
    id: challanId,
    challanNumber,
    studentProfileId: params.studentProfileId,
    studentName,
    creditApplied: totals.creditApplied,
    totalAmount: totals.totalAmount,
    dueDate,
    items: totals.items,
  };
}

/**
 * The `discount_overflow` credit already banked against one challan, in paise.
 *
 * Read rather than remembered, because the only durable record that a
 * repricing has already handed this surplus over is the credit row itself.
 * Keeping a flag on the challan would be a second source of truth, and the one
 * that goes wrong silently.
 */
async function grantedOverflowPaise(
  db: Database,
  locationId: string,
  challanId: string,
): Promise<number> {
  const rows = await db
    .select({ amount: studentCredits.amount })
    .from(studentCredits)
    .where(
      and(
        eq(studentCredits.locationId, locationId),
        eq(studentCredits.sourceChallanId, challanId),
        eq(studentCredits.reason, 'discount_overflow'),
      ),
    );

  let paise = 0;
  for (const row of rows) paise += toPaise(row.amount);
  return paise;
}

/**
 * Whether a thrown error is the admission index refusing a second voucher.
 *
 * postgres-js surfaces the server's fields on the error object, so the
 * constraint is readable without parsing the message — which is what makes it
 * safe to swallow this one violation and nothing else.
 */
function isAdmissionRaceViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;

  const { code, constraint_name: constraintName } = error as {
    code?: unknown;
    constraint_name?: unknown;
  };

  return code === '23505' && constraintName === 'fee_challans_admission_once_idx';
}

/**
 * When an admission voucher falls due: the school's own due day, never in the
 * past.
 *
 * ── The defect this replaces ─────────────────────────────────────────────
 * It used to be `defaultDueDate(currentMonth, currentYear, dueDay)`, which is
 * right for a monthly challan — that bill *is* for that month — and wrong for
 * an admission, which belongs to no month. A school on the 10th raising a
 * voucher on the 27th got a bill due seventeen days earlier: born overdue,
 * immediately on the defaulter list, and eligible for a late fee before the
 * parent had seen it.
 */
async function admissionDueDate(locationId: string): Promise<string> {
  const now = new Date();
  const dueDay = await getDueDay(locationId);

  const thisMonth = defaultDueDate(now.getMonth() + 1, now.getFullYear(), dueDay);
  const today = now.toISOString().slice(0, 10);

  // Already past this month's due day, so the voucher falls due next month.
  if (thisMonth >= today) return thisMonth;

  const next = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 1));
  return defaultDueDate(next.getUTCMonth() + 1, next.getUTCFullYear(), dueDay);
}

/** The student's name, for the message a caller shows after generating. */
async function getStudentName(
  db: Database,
  locationId: string,
  studentProfileId: string,
): Promise<string> {
  const rows = await db
    .select({ name: schoolUsers.name })
    .from(studentProfiles)
    .innerJoin(schoolUsers, eq(schoolUsers.id, studentProfiles.schoolUserId))
    .where(
      and(
        eq(studentProfiles.locationId, locationId),
        eq(studentProfiles.id, studentProfileId),
      ),
    )
    .limit(1);

  return rows[0]?.name ?? 'This student';
}

export interface BulkGenerateParams {
  locationId: string;
  actorUid: string;
  academicYearId: string;
  gradeId: string;
  sectionId?: string | undefined;
  billingMonth: number;
  billingYear: number;
  dueDate?: string | undefined;
  dueDay?: number | undefined;
}

export interface BulkCandidate {
  studentProfileId: string;
  studentName: string;
  studentId: string;
  sectionName: string;
  /** The challan they already hold for this period, when they do. */
  existingChallanNumber: string | null;
}

/**
 * Who a bulk run would bill, and who it would skip.
 *
 * The generate screen shows this before anything is written, because "you are
 * about to raise 214 challans" is a sentence a school wants to read first.
 */
export async function listBulkCandidates(
  db: Database,
  params: {
    locationId: string;
    academicYearId: string;
    gradeId: string;
    sectionId?: string | undefined;
    billingMonth: number;
    billingYear: number;
  },
): Promise<BulkCandidate[]> {
  const conditions = [
    eq(studentEnrollments.locationId, params.locationId),
    eq(studentEnrollments.academicYearId, params.academicYearId),
    eq(studentEnrollments.status, 'active'),
    eq(sections.gradeId, params.gradeId),
  ];

  if (params.sectionId !== undefined && params.sectionId !== '') {
    conditions.push(eq(sections.id, params.sectionId));
  }

  const enrolled = await db
    .select({
      studentProfileId: studentProfiles.id,
      studentName: schoolUsers.name,
      studentId: studentProfiles.studentId,
      sectionName: sections.name,
    })
    .from(studentEnrollments)
    .innerJoin(
      studentProfiles,
      eq(studentProfiles.id, studentEnrollments.studentProfileId),
    )
    .innerJoin(schoolUsers, eq(schoolUsers.id, studentProfiles.schoolUserId))
    .innerJoin(sections, eq(sections.id, studentEnrollments.sectionId))
    .where(and(...conditions));

  if (enrolled.length === 0) return [];

  const existing = await db
    .select({
      studentProfileId: feeChallans.studentProfileId,
      challanNumber: feeChallans.challanNumber,
    })
    .from(feeChallans)
    .where(
      and(
        eq(feeChallans.locationId, params.locationId),
        eq(feeChallans.academicYearId, params.academicYearId),
        eq(feeChallans.billingMonth, params.billingMonth),
        eq(feeChallans.billingYear, params.billingYear),
        inArray(
          feeChallans.studentProfileId,
          enrolled.map((row) => row.studentProfileId),
        ),
      ),
    );

  const alreadyBilled = new Map(
    existing.map((row) => [row.studentProfileId, row.challanNumber]),
  );

  return enrolled
    .map((row) => ({
      studentProfileId: row.studentProfileId,
      studentName: row.studentName,
      studentId: row.studentId,
      sectionName: row.sectionName,
      existingChallanNumber: alreadyBilled.get(row.studentProfileId) ?? null,
    }))
    .sort((left, right) => left.studentName.localeCompare(right.studentName));
}

export interface BulkGenerateResult {
  generated: number;
  skipped: number;
  failed: number;
  challans: Array<{ challanNumber: string; studentName: string; totalAmount: string }>;
  /** Why individual students were skipped, for the result summary. */
  problems: Array<{ studentName: string; reason: string }>;
}

/**
 * How many students are billed at once. Each one opens its own transaction and
 * so holds a connection for its duration; the bound keeps a bulk run inside the
 * pool `lib/postgres.ts` allows itself.
 */
const BULK_CONCURRENCY = 5;

/**
 * Raises a challan for every active student in a grade (or one section).
 *
 * Students who already hold a challan for the period are skipped rather than
 * billed twice — that is what makes a half-finished run safe to repeat. Each
 * student is written in their own batch, so one failure costs one challan.
 */
export async function bulkGenerateChallans(
  db: Database,
  params: BulkGenerateParams,
): Promise<BulkGenerateResult> {
  const candidates = await listBulkCandidates(db, params);
  const pending = candidates.filter(
    (candidate) => candidate.existingChallanNumber === null,
  );
  const skipped = candidates.length - pending.length;

  if (pending.length === 0) {
    return { generated: 0, skipped, failed: 0, challans: [], problems: [] };
  }

  const dueDate =
    params.dueDate ??
    defaultDueDate(
      params.billingMonth,
      params.billingYear,
      params.dueDay ?? (await getDueDay(params.locationId)),
    );

  const [structures, concessionsByStudent, schoolCode] = await Promise.all([
    listBillableStructures(params.locationId, params.gradeId, params.academicYearId),
    listActiveConcessionsForStudents(
      params.locationId,
      pending.map((candidate) => candidate.studentProfileId),
      dueDate,
    ),
    getSchoolCode(db, params.locationId),
  ]);

  if (structures.length === 0) {
    throw new ChallanGenerationError(
      'no_fee_structure',
      'No fee structure is set up for this grade in the selected academic year. Add one before generating challans.',
      409,
    );
  }

  // Reserved in one statement: taking them one at a time would be one round
  // trip per student, and the block is exclusively ours the moment it commits.
  const numbers = await reserveChallanNumbers(
    db,
    params.locationId,
    schoolCode,
    params.billingMonth,
    params.billingYear,
    pending.length,
  );

  const challans: BulkGenerateResult['challans'] = [];
  const problems: BulkGenerateResult['problems'] = [];
  let failed = 0;

  const writeOne = async (candidate: BulkCandidate, index: number): Promise<void> => {
    const challanNumber = numbers[index];
    if (challanNumber === undefined) {
      failed += 1;
      problems.push({
        studentName: candidate.studentName,
        reason: 'No challan number could be reserved.',
      });
      return;
    }

    /*
     * `calculateChallanLines`, not `calculateChallanItems`.
     *
     * The overflow — discount the per-line clamp could not absorb — was being
     * dropped here while both single-generation paths banked it, so a fixed
     * concession larger than a monthly fee simply ceased to exist on the one
     * run that raises almost every voucher a school issues. The calculator's
     * own docblock says it: anything that *writes* a challan uses this one.
     */
    const { items, overflowPaise } = calculateChallanLines(
      structures,
      concessionsByStudent.get(candidate.studentProfileId) ?? [],
      params.billingMonth,
    );

    if (items.length === 0) {
      failed += 1;
      problems.push({
        studentName: candidate.studentName,
        reason: 'No monthly fee heads are priced for this grade.',
      });
      return;
    }

    // The bulk run spends credit exactly as a single generation does. It has to:
    // the monthly run *is* "the next voucher" for almost every school, so a
    // credit that only a hand-raised challan could spend would sit on the
    // record for a year while the parent went on paying the full amount.
    const totals = applyCreditToTotals(
      summariseChallanItems(items),
      await getCreditBalancePaise(params.locationId, candidate.studentProfileId),
    );
    const challanId = crypto.randomUUID();

    try {
      await batch(db, (tx) => [
        tx.insert(feeChallans).values({
          id: challanId,
          locationId: params.locationId,
          studentProfileId: candidate.studentProfileId,
          academicYearId: params.academicYearId,
          challanNumber,
          billingMonth: params.billingMonth,
          billingYear: params.billingYear,
          dueDate,
          subtotal: totals.subtotal,
          concessionAmount: totals.concessionAmount,
          creditApplied: totals.creditApplied,
          totalAmount: totals.totalAmount,
          status: 'unpaid',
          generatedByUid: params.actorUid,
        }),
        ...items.map((item) =>
          tx.insert(feeChallanItems).values({
            locationId: params.locationId,
            challanId,
            feeTypeId: item.feeTypeId,
            description: item.description,
            amount: item.amount,
            concessionAmount: item.concessionAmount,
            netAmount: item.netAmount,
            concessionDetail: item.concessionDetail,
          }),
        ),
        ...consumeCreditStatements(tx, {
          locationId: params.locationId,
          studentProfileId: candidate.studentProfileId,
          challanId,
          creditApplied: totals.creditApplied,
          actorUid: params.actorUid,
        }),
        ...grantOverflowStatements(tx, {
          locationId: params.locationId,
          studentProfileId: candidate.studentProfileId,
          challanId,
          overflowPaise,
          actorUid: params.actorUid,
        }),
      ]);
      challans.push({
        challanNumber,
        studentName: candidate.studentName,
        totalAmount: totals.totalAmount,
      });
    } catch (error) {
      // One student's failure must not stop the run; the rest are already
      // written, and this student can be generated singly afterwards.
      failed += 1;
      problems.push({
        studentName: candidate.studentName,
        reason: 'The challan could not be written. Try generating it individually.',
      });
      console.warn(
        `[fee-challans] bulk generation failed for ${candidate.studentProfileId} at ${params.locationId}:`,
        error,
      );
    }
  };

  for (let start = 0; start < pending.length; start += BULK_CONCURRENCY) {
    const chunk = pending.slice(start, start + BULK_CONCURRENCY);
    await Promise.all(
      chunk.map(async (candidate, offset) => writeOne(candidate, start + offset)),
    );
  }

  return { generated: challans.length, skipped, failed, challans, problems };
}

/** What a repricing did to one challan. */
export interface RepricedChallan {
  id: string;
  challanNumber: string;
  /** What the parent was asked for before. */
  previousTotal: string;
  /** What they are asked for now. */
  newTotal: string;
  /** Discount that had nowhere to go and became a credit. `0.00` when none. */
  creditGranted: string;
}

export interface RepriceResult {
  repriced: RepricedChallan[];
  /**
   * Challans deliberately left alone, and why. Shown to the clerk who granted
   * the concession, because "your discount did not reach three of her bills" is
   * the sentence they need and nothing else on the screen would say it.
   */
  skipped: Array<{ challanNumber: string; reason: string }>;
}

/**
 * Re-applies a student's concessions to every challan they still owe on.
 *
 * ── The rule this implements, verbatim ───────────────────────────────────
 * *As long as the fee has not been paid, any discount applied will be
 * effective. If the discount has been applied afterwards, then it will appear
 * as adjustment in the next voucher.*
 *
 * Before Sprint 17 neither half happened. Granting a sibling discount wrote a
 * `student_concessions` row and stopped: every challan already raised went on
 * demanding the undiscounted amount, and the parent went on paying it. The
 * discount took effect on the *next* generation run, weeks later, and nothing
 * anywhere said the bills in between had missed it.
 *
 * ── The gross price is never re-read ─────────────────────────────────────
 * Lines are recomputed from the `amount` already frozen on each
 * `fee_challan_items` row, never from `fee_structures`. A challan is a record
 * of what was demanded, and March's tuition rise must not rewrite February's
 * bill. **Only the discount moves.**
 *
 * ── What is deliberately not touched ─────────────────────────────────────
 *  * `paid`, `waived` and `cancelled` challans. That is the "applied
 *    afterwards" case, and its answer is a credit, not an edit to history.
 *  * A challan folded into a family voucher. The voucher is the piece of paper
 *    the parent is holding and it is priced as a whole; silently changing one
 *    member's share would leave the two disagreeing. Reported, not edited.
 *
 * ── The floor, and where the surplus goes ────────────────────────────────
 * A discount can exceed what is left to collect — a large concession on a
 * partly paid challan is the ordinary case. The header is clamped to
 * `paid_amount`, so a parent is never handed a slip demanding a negative
 * amount, and the difference is written as a `discount_overflow` credit against
 * the challan that produced it. `previewChallan` spends it on the next voucher
 * as an Adjustment.
 *
 * Never throws for one bad challan: the concession has already been written by
 * the time this runs, and a repricing failure must not take the concession with
 * it. The caller reports what moved and what did not.
 */
export async function repriceOpenChallans(
  db: Database,
  params: { locationId: string; studentProfileId: string; actorUid: string },
): Promise<RepriceResult> {
  const result: RepriceResult = { repriced: [], skipped: [] };

  const challans = await db
    .select({
      id: feeChallans.id,
      challanNumber: feeChallans.challanNumber,
      dueDate: feeChallans.dueDate,
      concessionAmount: feeChallans.concessionAmount,
      creditApplied: feeChallans.creditApplied,
      lateFeeAmount: feeChallans.lateFeeAmount,
      totalAmount: feeChallans.totalAmount,
      paidAmount: feeChallans.paidAmount,
      familyChallanId: feeChallans.familyChallanId,
    })
    .from(feeChallans)
    .where(
      and(
        eq(feeChallans.locationId, params.locationId),
        eq(feeChallans.studentProfileId, params.studentProfileId),
        inArray(feeChallans.status, [...OPEN_CHALLAN_STATUSES]),
      ),
    );

  for (const challan of challans) {
    if (challan.familyChallanId !== null) {
      result.skipped.push({
        challanNumber: challan.challanNumber,
        reason:
          'It is part of a family voucher, which is priced as a whole and is what the parent is holding.',
      });
      continue;
    }

    try {
      const repriced = await repriceOneChallan(db, {
        locationId: params.locationId,
        studentProfileId: params.studentProfileId,
        actorUid: params.actorUid,
        challan,
      });

      if (repriced !== null) result.repriced.push(repriced);
    } catch (error) {
      result.skipped.push({
        challanNumber: challan.challanNumber,
        reason: 'It could not be repriced. The concession itself was saved.',
      });
      console.warn(
        `[fee-challans] repricing failed for challan ${challan.id} at ${params.locationId}:`,
        error,
      );
    }
  }

  return result;
}

/** One challan's worth of `repriceOpenChallans`. Null when nothing changed. */
async function repriceOneChallan(
  db: Database,
  input: {
    locationId: string;
    studentProfileId: string;
    actorUid: string;
    challan: {
      id: string;
      challanNumber: string;
      dueDate: string;
      lateFeeAmount: string;
      creditApplied: string;
      concessionAmount: string;
      totalAmount: string;
      paidAmount: string;
    };
  },
): Promise<RepricedChallan | null> {
  const { challan } = input;

  const [lines, concessions] = await Promise.all([
    db
      .select({
        id: feeChallanItems.id,
        feeTypeId: feeChallanItems.feeTypeId,
        description: feeChallanItems.description,
        amount: feeChallanItems.amount,
        concessionAmount: feeChallanItems.concessionAmount,
        concessionDetail: feeChallanItems.concessionDetail,
      })
      .from(feeChallanItems)
      .where(
        and(
          eq(feeChallanItems.locationId, input.locationId),
          eq(feeChallanItems.challanId, challan.id),
        ),
      ),
    // Priced against the challan's own due date, exactly as generation is, so a
    // concession that only starts next term does not reach last term's bill.
    listActiveConcessions(input.locationId, input.studentProfileId, challan.dueDate),
  ]);

  if (lines.length === 0) return null;

  const feeCategories = await feeCategoriesFor(
    db,
    input.locationId,
    lines.map((line) => line.feeTypeId).filter((id): id is string => id !== null),
  );

  let subtotalPaise = 0;
  let concessionPaise = 0;
  // Discount the individual lines could not absorb. Banked as a credit below,
  // exactly as it is on a freshly generated challan — the clamp must not be
  // the last thing that knows about it.
  let lineOverflowPaise = 0;
  const updates: Array<{
    id: string;
    concessionAmount: string;
    netAmount: string;
    concessionDetail: string | null;
  }> = [];

  for (const line of lines) {
    const amountPaise = toPaise(line.amount);
    subtotalPaise += amountPaise;

    // A line whose fee head has since been deleted carries a null
    // `fee_type_id`. It keeps the concession it was given: no head-specific
    // rule can be matched against it any more, and re-pricing it to zero
    // discount would take money off a parent because the school tidied its
    // fee types.
    if (line.feeTypeId === null) {
      concessionPaise += toPaise(line.concessionAmount);
      continue;
    }

    // The gross `amount` is the frozen one off the row. Only the discount is
    // recomputed — that is the whole contract of this function.
    const pricedLines = calculateChallanLines(
      [
        {
          feeTypeId: line.feeTypeId,
          description: line.description,
          feeCategory: feeCategories.get(line.feeTypeId) ?? 'monthly',
          amount: line.amount,
        },
      ],
      concessions,
    );

    lineOverflowPaise += pricedLines.overflowPaise;

    const linePaise = toPaise(pricedLines.items[0]?.concessionAmount ?? '0');
    concessionPaise += linePaise;

    const detail = pricedLines.items[0]?.concessionDetail ?? null;

    // The explanation moves with the figure, or the two drift: a line saying
    // `−4,000 · Sibling Discount 20%` after the discount was withdrawn is worse
    // than one saying nothing, because it is confidently wrong.
    if (linePaise !== toPaise(line.concessionAmount) || detail !== line.concessionDetail) {
      updates.push({
        id: line.id,
        concessionAmount: paiseToNumeric(linePaise),
        netAmount: paiseToNumeric(amountPaise - linePaise),
        concessionDetail: detail,
      });
    }
  }

  const creditPaise = toPaise(challan.creditApplied);
  const latePaise = toPaise(challan.lateFeeAmount);
  const paidPaise = toPaise(challan.paidAmount);

  const uncappedPaise = subtotalPaise - concessionPaise - creditPaise + latePaise;
  // The floor. A challan may not demand less than has already been handed over
  // at a counter: that money is in the school's drawer, and a slip saying the
  // parent is owed it is a slip nobody can act on.
  const totalPaise = Math.max(uncappedPaise, paidPaise);

  /*
   * Two different overflows, and both are the parent's money.
   *
   * `totalPaise - uncappedPaise` is what the *challan* floor threw away — the
   * discount pushed the bill below what has already been paid. `lineOverflowPaise`
   * is what the *line* clamps threw away, and it is the one QA found missing: a
   * fixed 60,000 against a 50,000 admission fee floored every line at zero, so
   * the challan total was already 0 and the header floor had nothing left to
   * notice. The 10,000 difference simply vanished.
   */
  const grossOverflowPaise = totalPaise - uncappedPaise + lineOverflowPaise;

  /*
   * Only the *new* surplus is banked.
   *
   * `repriceOpenChallans` runs on every concession write — create, amend and
   * delete — so this function is re-entered against the same challan many
   * times over a student's year, and each run recomputes the same clamp from
   * the same rows. Granting `grossOverflowPaise` every time would hand the
   * parent another 10,000 for every unrelated concession the school touched
   * afterwards, and nothing on any screen would look wrong until the credit
   * balance had drifted into money the school never meant to give away.
   *
   * So the credit already banked against this challan is subtracted, and what
   * is left — usually nothing — is what gets written. That makes repricing
   * idempotent with respect to credit, which is the only property that makes
   * it safe to call as often as it is called.
   */
  const alreadyGrantedPaise = await grantedOverflowPaise(
    db,
    input.locationId,
    challan.id,
  );
  const overflowPaise = Math.max(0, grossOverflowPaise - alreadyGrantedPaise);

  const previousTotalPaise = toPaise(challan.totalAmount);
  const previousConcessionPaise = toPaise(challan.concessionAmount);

  if (
    updates.length === 0 &&
    totalPaise === previousTotalPaise &&
    concessionPaise === previousConcessionPaise &&
    overflowPaise <= 0
  ) {
    return null;
  }

  await batch(db, (tx) => [
    ...updates.map((update) =>
      tx
        .update(feeChallanItems)
        .set({
          concessionAmount: update.concessionAmount,
          netAmount: update.netAmount,
          concessionDetail: update.concessionDetail,
        })
        .where(eq(feeChallanItems.id, update.id)),
    ),
    tx
      .update(feeChallans)
      .set({
        concessionAmount: paiseToNumeric(concessionPaise),
        totalAmount: paiseToNumeric(totalPaise),
        updatedAt: new Date(),
      })
      .where(
        and(eq(feeChallans.locationId, input.locationId), eq(feeChallans.id, challan.id)),
      ),
    // The surplus, if the floor bit. Written in the same transaction as the
    // clamp that created it — a credit granted by a repricing that then rolled
    // back is money invented out of nothing.
    ...(overflowPaise > 0
      ? [
          tx.insert(studentCredits).values({
            locationId: input.locationId,
            studentProfileId: input.studentProfileId,
            amount: paiseToNumeric(overflowPaise),
            reason: 'discount_overflow' as const,
            sourceChallanId: challan.id,
            notes: `Discount larger than the balance left on ${challan.challanNumber}.`,
            createdByUid: input.actorUid,
          }),
        ]
      : []),
  ]);

  return {
    id: challan.id,
    challanNumber: challan.challanNumber,
    previousTotal: paiseToNumeric(previousTotalPaise),
    newTotal: paiseToNumeric(totalPaise),
    creditGranted: paiseToNumeric(Math.max(overflowPaise, 0)),
  };
}

/**
 * The category of each fee head named on a challan's lines.
 *
 * Read live rather than frozen on the line, because `fee_challan_items` has
 * never carried it. It is consulted only by `concessionPaiseFor`, which since
 * Sprint 17 ignores the category entirely for an unqualified concession and
 * matches on the head id for a qualified one — so the fallback below is never
 * load-bearing. It is read at all so that the next rule to narrow by category
 * has the right value in front of it rather than a guess.
 */
async function feeCategoriesFor(
  db: Database,
  locationId: string,
  feeTypeIds: readonly string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (feeTypeIds.length === 0) return result;

  const rows = await db
    .select({ id: feeTypes.id, feeCategory: feeTypes.feeCategory })
    .from(feeTypes)
    .where(
      and(eq(feeTypes.locationId, locationId), inArray(feeTypes.id, [...feeTypeIds])),
    );

  for (const row of rows) result.set(row.id, row.feeCategory);
  return result;
}
