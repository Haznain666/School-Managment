import 'server-only';

import { randomUUID } from 'node:crypto';

import { and, eq, inArray } from 'drizzle-orm';

import {
  academicYears,
  feeChallanItems,
  feeChallans,
  feeStructures,
  feeTypes,
  grades,
  lateFeeRules,
  schools,
  sections,
  studentConcessions,
  studentEnrollments,
  type FeeCategory,
} from '@/db/schema';

import { generateChallanNumber } from './challan-number';
import type { Database } from './drizzle';
import {
  calculateChallanItems,
  summariseChallan,
  type ChallanItemCalculation,
  type ConcessionInput,
  type FeeStructureInput,
} from './fee-calculator';
import { paiseToNumericString } from './money';
import { DEFAULT_DUE_DAY } from '@/db/schema/late-fee-rules';

/**
 * Raising a challan — the one place it happens.
 *
 * Single generation and bulk generation share this, so a challan raised for one
 * student is indistinguishable from one raised in a run of four hundred.
 *
 * ── On atomicity ─────────────────────────────────────────────────────────
 * A challan with no line items is a bill for an unexplained amount, so the
 * challan row and its items go out as one `db.batch()`, which Neon runs as a
 * single transaction. Batched statements cannot read each other's output, so
 * the challan's primary key is minted with `randomUUID()` rather than read back
 * from `RETURNING` — the same technique Sprint 4's enrolment uses, and for the
 * same reason: the HTTP driver has no interactive transactions.
 *
 * The challan number is issued just before the batch and is therefore not
 * covered by it. A failed batch spends that number and the next challan skips
 * it. Gaps in a challan series are unremarkable; duplicates would not be.
 */

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

/**
 * Which fee heads land on a monthly challan.
 *
 * Only `monthly` by default. Billing the annual charges every month would
 * quietly overcharge every family in the school, so including `annual` or
 * `one_time` has to be asked for — typically on the first challan of a session.
 */
export const DEFAULT_BILLED_CATEGORIES: readonly FeeCategory[] = ['monthly'];

export interface GenerateChallanParams {
  /** Tenant key — always from verified session claims. */
  locationId: string;
  /** Firebase uid of the admin generating it. */
  actorUid: string;
  studentProfileId: string;
  billingMonth: number;
  billingYear: number;
  academicYearId: string;
  /** `YYYY-MM-DD`. Defaults to the school's configured due day. */
  dueDate?: string | null;
  /** Fee categories to bill. Defaults to monthly only. */
  categories?: readonly FeeCategory[];
}

export interface GeneratedChallan {
  challanId: string;
  challanNumber: string;
  studentProfileId: string;
  totalPaise: number;
  itemCount: number;
}

/** The school's configured due day, falling back to the 10th. */
export async function resolveDueDay(
  db: Database,
  locationId: string,
): Promise<number> {
  const rows = await db
    .select({ dueDayOfMonth: lateFeeRules.dueDayOfMonth })
    .from(lateFeeRules)
    .where(eq(lateFeeRules.locationId, locationId))
    .limit(1);

  return rows[0]?.dueDayOfMonth ?? DEFAULT_DUE_DAY;
}

/** `YYYY-MM-DD` for a given day within a billing month. */
export function dueDateFor(
  billingMonth: number,
  billingYear: number,
  dueDay: number,
): string {
  // Capped at 28 so no month is ever short of the configured day.
  const day = Math.min(Math.max(dueDay, 1), 28);
  return `${billingYear}-${String(billingMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export interface StudentBillingContext {
  studentProfileId: string;
  gradeId: string;
  /** Display label — the school's override where it set one. */
  gradeName: string;
  sectionId: string;
}

/**
 * Resolves the grade a student is billed against.
 *
 * Fees follow the enrolment, not the profile: a student with no active
 * placement in the selected academic year has no grade, and therefore no fee
 * structure to bill from. Saying so is better than raising a zero challan.
 */
export async function loadBillingContext(
  db: Database,
  locationId: string,
  studentProfileId: string,
  academicYearId: string,
): Promise<StudentBillingContext | null> {
  const rows = await db
    .select({
      studentProfileId: studentEnrollments.studentProfileId,
      gradeId: grades.id,
      gradeName: grades.name,
      gradeDisplayName: grades.displayName,
      sectionId: sections.id,
    })
    .from(studentEnrollments)
    .innerJoin(sections, eq(sections.id, studentEnrollments.sectionId))
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .where(
      and(
        eq(studentEnrollments.locationId, locationId),
        eq(studentEnrollments.studentProfileId, studentProfileId),
        eq(studentEnrollments.academicYearId, academicYearId),
        eq(studentEnrollments.status, 'active'),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (row === undefined) return null;

  return {
    studentProfileId: row.studentProfileId,
    gradeId: row.gradeId,
    gradeName:
      row.gradeDisplayName === null || row.gradeDisplayName === ''
        ? row.gradeName
        : row.gradeDisplayName,
    sectionId: row.sectionId,
  };
}

/** Fee structure rows for one grade and year, limited to the billed heads. */
export async function loadFeeStructures(
  db: Database,
  locationId: string,
  gradeId: string,
  academicYearId: string,
  categories: readonly FeeCategory[],
): Promise<FeeStructureInput[]> {
  if (categories.length === 0) return [];

  const rows = await db
    .select({
      feeTypeId: feeTypes.id,
      feeTypeName: feeTypes.name,
      amount: feeStructures.amount,
      sortOrder: feeTypes.sortOrder,
    })
    .from(feeStructures)
    .innerJoin(feeTypes, eq(feeTypes.id, feeStructures.feeTypeId))
    .where(
      and(
        eq(feeStructures.locationId, locationId),
        eq(feeStructures.gradeId, gradeId),
        eq(feeStructures.academicYearId, academicYearId),
        eq(feeTypes.isActive, true),
        inArray(feeTypes.feeCategory, [...categories]),
      ),
    );

  return rows;
}

/** A student's concessions, unfiltered by date — the calculator does that. */
export async function loadConcessions(
  db: Database,
  locationId: string,
  studentProfileId: string,
): Promise<ConcessionInput[]> {
  return db
    .select({
      discountType: studentConcessions.discountType,
      discountValue: studentConcessions.discountValue,
      appliesToFeeTypeId: studentConcessions.appliesToFeeTypeId,
      validFrom: studentConcessions.validFrom,
      validUntil: studentConcessions.validUntil,
    })
    .from(studentConcessions)
    .where(
      and(
        eq(studentConcessions.locationId, locationId),
        eq(studentConcessions.studentProfileId, studentProfileId),
      ),
    );
}

/**
 * Computes what a student's challan would contain, without writing anything.
 * Used by the generation wizard's preview and by generation itself, so the
 * preview cannot disagree with the result.
 */
export async function previewChallan(
  db: Database,
  params: GenerateChallanParams,
): Promise<{
  context: StudentBillingContext;
  items: ChallanItemCalculation[];
  subtotalPaise: number;
  concessionPaise: number;
  totalPaise: number;
} | null> {
  const context = await loadBillingContext(
    db,
    params.locationId,
    params.studentProfileId,
    params.academicYearId,
  );
  if (context === null) return null;

  const categories = params.categories ?? DEFAULT_BILLED_CATEGORIES;

  const [structures, concessions] = await Promise.all([
    loadFeeStructures(
      db,
      params.locationId,
      context.gradeId,
      params.academicYearId,
      categories,
    ),
    loadConcessions(db, params.locationId, params.studentProfileId),
  ]);

  const items = calculateChallanItems({
    feeStructures: structures,
    concessions,
    billingMonth: params.billingMonth,
    billingYear: params.billingYear,
  });

  const summary = summariseChallan(items);

  return {
    context,
    items,
    subtotalPaise: summary.subtotal,
    concessionPaise: summary.concessionTotal,
    totalPaise: summary.total,
  };
}

/** True when this student already has a challan for this billing period. */
export async function challanExists(
  db: Database,
  locationId: string,
  studentProfileId: string,
  billingMonth: number,
  billingYear: number,
  academicYearId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: feeChallans.id })
    .from(feeChallans)
    .where(
      and(
        eq(feeChallans.locationId, locationId),
        eq(feeChallans.studentProfileId, studentProfileId),
        eq(feeChallans.billingMonth, billingMonth),
        eq(feeChallans.billingYear, billingYear),
        eq(feeChallans.academicYearId, academicYearId),
      ),
    )
    .limit(1);

  return rows[0] !== undefined;
}

/**
 * Raises one challan, with its line items, in a single transaction.
 *
 * @throws {ChallanGenerationError} for anything the caller can act on — no
 *   enrolment, no fee structure, a duplicate period, or a missing school code.
 */
export async function generateChallan(
  db: Database,
  params: GenerateChallanParams,
): Promise<GeneratedChallan> {
  const { locationId, billingMonth, billingYear, academicYearId } = params;

  if (!Number.isInteger(billingMonth) || billingMonth < 1 || billingMonth > 12) {
    throw new ChallanGenerationError('invalid_period', 'Select a billing month.');
  }
  if (!Number.isInteger(billingYear) || billingYear < 2000 || billingYear > 2100) {
    throw new ChallanGenerationError('invalid_period', 'Select a billing year.');
  }

  const yearRows = await db
    .select({ id: academicYears.id })
    .from(academicYears)
    .where(
      and(
        eq(academicYears.id, academicYearId),
        eq(academicYears.locationId, locationId),
      ),
    )
    .limit(1);

  if (yearRows[0] === undefined) {
    throw new ChallanGenerationError(
      'invalid_year',
      'That academic year does not belong to this school.',
    );
  }

  if (
    await challanExists(
      db,
      locationId,
      params.studentProfileId,
      billingMonth,
      billingYear,
      academicYearId,
    )
  ) {
    throw new ChallanGenerationError(
      'already_exists',
      'This student already has a challan for that month.',
      409,
    );
  }

  const preview = await previewChallan(db, params);
  if (preview === null) {
    throw new ChallanGenerationError(
      'no_enrollment',
      'This student has no active enrolment in the selected academic year, so there is no grade to bill against.',
    );
  }

  if (preview.items.length === 0) {
    throw new ChallanGenerationError(
      'no_fee_structure',
      `No fee structure is set for ${preview.context.gradeName} in this academic year. Set the amounts before generating challans.`,
    );
  }

  const schoolRows = await db
    .select({ name: schools.name, schoolCode: schools.schoolCode })
    .from(schools)
    .where(and(eq(schools.locationId, locationId), eq(schools.isActive, true)))
    .limit(1);

  const school = schoolRows[0];
  if (school === undefined) {
    throw new ChallanGenerationError('no_school', 'This school is not available.', 404);
  }

  if (school.schoolCode === null || school.schoolCode === '') {
    throw new ChallanGenerationError(
      'no_school_code',
      'This school has no school code set, so challan numbers cannot be issued.',
      409,
    );
  }

  const dueDay = await resolveDueDay(db, locationId);
  const dueDate =
    params.dueDate !== null && params.dueDate !== undefined && params.dueDate !== ''
      ? params.dueDate
      : dueDateFor(billingMonth, billingYear, dueDay);

  const challanNumber = await generateChallanNumber(
    db,
    locationId,
    school.schoolCode,
    billingMonth,
    billingYear,
  );

  const challanId = randomUUID();

  const itemRows = preview.items.map((item) => ({
    id: randomUUID(),
    locationId,
    challanId,
    feeTypeId: item.feeTypeId,
    description: item.description,
    amount: paiseToNumericString(item.amount),
    concessionAmount: paiseToNumericString(item.concessionAmount),
    netAmount: paiseToNumericString(item.netAmount),
  }));

  const [firstItem, ...restItems] = itemRows;
  if (firstItem === undefined) {
    throw new ChallanGenerationError('no_fee_structure', 'Nothing to bill.');
  }

  try {
    await db.batch([
      db.insert(feeChallans).values({
        id: challanId,
        locationId,
        studentProfileId: params.studentProfileId,
        academicYearId,
        challanNumber,
        billingMonth,
        billingYear,
        dueDate,
        subtotal: paiseToNumericString(preview.subtotalPaise),
        concessionAmount: paiseToNumericString(preview.concessionPaise),
        // Late fees accrue against the due date and are computed at read time,
        // so a freshly raised challan always starts at zero.
        lateFeeAmount: '0',
        totalAmount: paiseToNumericString(preview.totalPaise),
        paidAmount: '0',
        status: 'unpaid',
        generatedByUid: params.actorUid,
      }),
      db.insert(feeChallanItems).values([firstItem, ...restItems]),
    ]);
  } catch (error) {
    console.error('[challan-generation] write failed:', error);
    throw new ChallanGenerationError(
      'write_failed',
      'Could not raise the challan. Please try again.',
      409,
    );
  }

  return {
    challanId,
    challanNumber,
    studentProfileId: params.studentProfileId,
    totalPaise: preview.totalPaise,
    itemCount: itemRows.length,
  };
}

export interface BulkGenerationResult {
  generated: number;
  skipped: number;
  errors: Array<{ studentProfileId: string; message: string }>;
  challans: GeneratedChallan[];
}

/**
 * Raises challans for every actively enrolled student in a grade or section.
 *
 * Sequential rather than parallel: each student needs its own challan number
 * from a row-locked counter, and firing four hundred concurrent upserts at one
 * row would serialise them anyway while multiplying the connection pressure.
 *
 * One student's failure never stops the run — a missing fee structure for one
 * grade should not deny the other three hundred their bills. Failures come back
 * itemised so the admin can see exactly who was missed and why.
 */
export async function bulkGenerateChallans(
  db: Database,
  params: {
    locationId: string;
    actorUid: string;
    gradeId: string;
    sectionId?: string | null;
    billingMonth: number;
    billingYear: number;
    academicYearId: string;
    dueDate?: string | null;
    categories?: readonly FeeCategory[];
  },
): Promise<BulkGenerationResult> {
  const conditions = [
    eq(studentEnrollments.locationId, params.locationId),
    eq(studentEnrollments.academicYearId, params.academicYearId),
    eq(studentEnrollments.status, 'active'),
    eq(sections.gradeId, params.gradeId),
  ];

  if (params.sectionId !== undefined && params.sectionId !== null && params.sectionId !== '') {
    conditions.push(eq(studentEnrollments.sectionId, params.sectionId));
  }

  const students = await db
    .select({ studentProfileId: studentEnrollments.studentProfileId })
    .from(studentEnrollments)
    .innerJoin(sections, eq(sections.id, studentEnrollments.sectionId))
    .where(and(...conditions));

  const result: BulkGenerationResult = {
    generated: 0,
    skipped: 0,
    errors: [],
    challans: [],
  };

  for (const student of students) {
    try {
      const challan = await generateChallan(db, {
        locationId: params.locationId,
        actorUid: params.actorUid,
        studentProfileId: student.studentProfileId,
        billingMonth: params.billingMonth,
        billingYear: params.billingYear,
        academicYearId: params.academicYearId,
        dueDate: params.dueDate ?? null,
        ...(params.categories === undefined ? {} : { categories: params.categories }),
      });

      result.generated += 1;
      result.challans.push(challan);
    } catch (error) {
      // A student who already has this month's challan is the expected case on
      // a re-run, not an error worth reporting.
      if (
        error instanceof ChallanGenerationError &&
        error.code === 'already_exists'
      ) {
        result.skipped += 1;
        continue;
      }

      result.errors.push({
        studentProfileId: student.studentProfileId,
        message:
          error instanceof ChallanGenerationError
            ? error.message
            : 'Could not raise a challan for this student.',
      });
    }
  }

  return result;
}

/** Students in a grade or section who do not yet have a challan for a period. */
export async function countBillableStudents(
  db: Database,
  params: {
    locationId: string;
    gradeId: string;
    sectionId?: string | null;
    billingMonth: number;
    billingYear: number;
    academicYearId: string;
  },
): Promise<{ total: number; alreadyBilled: number; toGenerate: number }> {
  const conditions = [
    eq(studentEnrollments.locationId, params.locationId),
    eq(studentEnrollments.academicYearId, params.academicYearId),
    eq(studentEnrollments.status, 'active'),
    eq(sections.gradeId, params.gradeId),
  ];

  if (params.sectionId !== undefined && params.sectionId !== null && params.sectionId !== '') {
    conditions.push(eq(studentEnrollments.sectionId, params.sectionId));
  }

  const students = await db
    .select({ studentProfileId: studentEnrollments.studentProfileId })
    .from(studentEnrollments)
    .innerJoin(sections, eq(sections.id, studentEnrollments.sectionId))
    .where(and(...conditions));

  if (students.length === 0) {
    return { total: 0, alreadyBilled: 0, toGenerate: 0 };
  }

  const ids = students.map((student) => student.studentProfileId);

  const existing = await db
    .select({ studentProfileId: feeChallans.studentProfileId })
    .from(feeChallans)
    .where(
      and(
        eq(feeChallans.locationId, params.locationId),
        eq(feeChallans.academicYearId, params.academicYearId),
        eq(feeChallans.billingMonth, params.billingMonth),
        eq(feeChallans.billingYear, params.billingYear),
        inArray(feeChallans.studentProfileId, ids),
      ),
    );

  const alreadyBilled = new Set(existing.map((row) => row.studentProfileId)).size;

  return {
    total: students.length,
    alreadyBilled,
    toGenerate: students.length - alreadyBilled,
  };
}
