import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';

import {
  feeChallanItems,
  feeChallans,
  grades,
  schoolUsers,
  schools,
  sections,
  studentEnrollments,
  studentProfiles,
  gradeLabel,
} from '@/db/schema';

import { generateChallanNumber, reserveChallanNumbers } from './challan-number';
import { batch, type Database } from './drizzle';
import {
  calculateChallanItems,
  defaultDueDate,
  summariseChallanItems,
  type ChallanItem,
  type ChallanTotals,
} from './fee-calculator';
import {
  getDueDay,
  listActiveConcessions,
  listActiveConcessionsForStudents,
  listBillableStructures,
} from './fee-queries';

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

  const items = calculateChallanItems(structures, concessions, params.billingMonth);

  if (items.length === 0) {
    throw new ChallanGenerationError(
      'no_monthly_fees',
      `${placement.gradeName} has no monthly fee heads priced for this year, so a monthly challan would be empty.`,
      409,
    );
  }

  return {
    ...summariseChallanItems(items),
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
      }),
    ),
  ]);

  return {
    id: challanId,
    challanNumber,
    studentProfileId: params.studentProfileId,
    studentName: preview.studentName,
    totalAmount: preview.totalAmount,
    dueDate: preview.dueDate,
    items: preview.items,
  };
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

    const items = calculateChallanItems(
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

    const totals = summariseChallanItems(items);
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
          }),
        ),
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
