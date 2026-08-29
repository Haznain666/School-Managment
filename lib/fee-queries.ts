import 'server-only';

import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import {
  academicYears,
  branches,
  feeChallanItems,
  feeChallans,
  feePayments,
  feeStructures,
  feeTypes,
  grades,
  lateFeeRules,
  schoolUsers,
  schools,
  sections,
  studentConcessionFeeTypes,
  studentConcessions,
  studentCredits,
  studentEnrollments,
  studentGuardians,
  studentProfiles,
  gradeLabel,
  isChallanStatus,
  type ChallanKind,
  type ChallanKindFilter,
  type ChallanStatus,
  type CreditReason,
  type DiscountType,
  type FeeCategory,
  type LateFeeType,
  type PaymentMethod,
} from '@/db/schema';

import { sharedOrOwnedBy } from './branch-scope';
import { db, type Database, type Tx } from './drizzle';
import { daysOverdue, remainingBalance } from './fee-calculator';
import { toPaise } from './money';

/**
 * Tenant-scoped reads for the Fee Management module.
 *
 * Same contract as `lib/school-queries.ts` and `lib/admissions-queries.ts`:
 * every function takes `locationId` first and filters on it, and that value
 * must have come from verified session claims. Nothing here may be called with
 * an id taken out of a request body.
 */

// -----------------------------------------------------------------------------
// Fee types
// -----------------------------------------------------------------------------

export interface FeeTypeRow {
  id: string;
  name: string;
  description: string | null;
  feeCategory: FeeCategory;
  isActive: boolean;
  sortOrder: number;
}

export async function listFeeTypes(
  locationId: string,
  options: { activeOnly?: boolean; branchIds?: string[] | null | undefined } = {},
): Promise<FeeTypeRow[]> {
  const conditions: SQL[] = [eq(feeTypes.locationId, locationId)];
  if (options.activeOnly === true) conditions.push(eq(feeTypes.isActive, true));

  // Shared heads plus this campus's own. Never `eq` — see `lib/branch-scope.ts`;
  // a bare equality here would empty the price-list matrix at every school,
  // because every fee head in production today is shared.
  const branchFilter = sharedOrOwnedBy(feeTypes.branchId, options.branchIds ?? null);
  if (branchFilter !== undefined) conditions.push(branchFilter);

  return db
    .select({
      id: feeTypes.id,
      name: feeTypes.name,
      description: feeTypes.description,
      feeCategory: feeTypes.feeCategory,
      isActive: feeTypes.isActive,
      sortOrder: feeTypes.sortOrder,
    })
    .from(feeTypes)
    .where(and(...conditions))
    .orderBy(asc(feeTypes.sortOrder), asc(feeTypes.name));
}

export async function getFeeType(
  locationId: string,
  feeTypeId: string,
): Promise<FeeTypeRow | null> {
  const rows = await db
    .select({
      id: feeTypes.id,
      name: feeTypes.name,
      description: feeTypes.description,
      feeCategory: feeTypes.feeCategory,
      isActive: feeTypes.isActive,
      sortOrder: feeTypes.sortOrder,
    })
    .from(feeTypes)
    .where(and(eq(feeTypes.locationId, locationId), eq(feeTypes.id, feeTypeId)))
    .limit(1);

  return rows[0] ?? null;
}

// -----------------------------------------------------------------------------
// Fee structures (the price-list matrix)
// -----------------------------------------------------------------------------

export interface FeeStructureCell {
  feeTypeId: string;
  gradeId: string;
  amount: string;
}

export interface FeeStructureMatrix {
  feeTypes: FeeTypeRow[];
  grades: Array<{ id: string; label: string; sortOrder: number; branchId: string }>;
  cells: FeeStructureCell[];
}

/**
 * The price list for one academic year, shaped for the matrix editor.
 *
 * Grades are the rows and active fee heads the columns; `cells` carries only
 * the pairs that actually have a price, so a blank cell genuinely means "not
 * charged" rather than "zero".
 */
export async function getFeeStructureMatrix(
  locationId: string,
  academicYearId: string,
  branchId?: string | undefined,
): Promise<FeeStructureMatrix> {
  const gradeConditions: SQL[] = [
    eq(grades.locationId, locationId),
    eq(grades.isActive, true),
  ];
  if (branchId !== undefined && branchId !== '') {
    gradeConditions.push(eq(grades.branchId, branchId));
  }

  const [types, gradeRows, cellRows] = await Promise.all([
    listFeeTypes(locationId, { activeOnly: true }),
    db
      .select({
        id: grades.id,
        name: grades.name,
        displayName: grades.displayName,
        sortOrder: grades.sortOrder,
        branchId: grades.branchId,
      })
      .from(grades)
      .where(and(...gradeConditions))
      .orderBy(asc(grades.sortOrder)),
    db
      .select({
        feeTypeId: feeStructures.feeTypeId,
        gradeId: feeStructures.gradeId,
        amount: feeStructures.amount,
      })
      .from(feeStructures)
      .where(
        and(
          eq(feeStructures.locationId, locationId),
          eq(feeStructures.academicYearId, academicYearId),
        ),
      ),
  ]);

  const gradeIds = new Set(gradeRows.map((row) => row.id));

  return {
    feeTypes: types,
    grades: gradeRows.map((row) => ({
      id: row.id,
      label: gradeLabel({ name: row.name, displayName: row.displayName }),
      sortOrder: row.sortOrder,
      branchId: row.branchId,
    })),
    // A structure for a grade outside the selected branch is not this matrix's
    // business, and showing it would let a save overwrite another branch's price.
    cells: cellRows.filter((cell) => gradeIds.has(cell.gradeId)),
  };
}

/** Price-list rows for one grade and year, with the head's name and category. */
export interface BillableStructure {
  feeTypeId: string;
  description: string;
  feeCategory: FeeCategory;
  amount: string;
  sortOrder: number;
}

export async function listBillableStructures(
  locationId: string,
  gradeId: string,
  academicYearId: string,
): Promise<BillableStructure[]> {
  return db
    .select({
      feeTypeId: feeStructures.feeTypeId,
      description: feeTypes.name,
      feeCategory: feeTypes.feeCategory,
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
      ),
    )
    .orderBy(asc(feeTypes.sortOrder), asc(feeTypes.name));
}

// -----------------------------------------------------------------------------
// Concessions
// -----------------------------------------------------------------------------

export interface ConcessionRow {
  id: string;
  studentProfileId: string;
  concessionName: string;
  discountType: DiscountType;
  discountValue: string;
  appliesToFeeTypeId: string | null;
  appliesToFeeTypeName: string | null;
  /**
   * The Sprint 18 head *set*, by name, for the screen to describe the grant.
   *
   * Without it the panel could only read the legacy single-head column, which
   * a multi-select grant leaves null — so a concession the clerk had scoped to
   * Tuition Fee alone was described on screen as "off every fee head". The
   * calculator was right and the sentence above it was wrong, which is the
   * worst of the two to get wrong: nothing errors and the clerk reads a
   * discount that is wider than the one they granted.
   *
   * Empty **and** a null legacy column genuinely does mean every head.
   */
  appliesToFeeTypeNames: string[];
  validFrom: string;
  validUntil: string | null;
  notes: string | null;
  approvedByUid: string | null;
}

export async function listConcessions(
  locationId: string,
  studentProfileId: string,
): Promise<ConcessionRow[]> {
  const rows = await db
    .select({
      id: studentConcessions.id,
      studentProfileId: studentConcessions.studentProfileId,
      concessionName: studentConcessions.concessionName,
      discountType: studentConcessions.discountType,
      discountValue: studentConcessions.discountValue,
      appliesToFeeTypeId: studentConcessions.appliesToFeeTypeId,
      appliesToFeeTypeName: feeTypes.name,
      validFrom: studentConcessions.validFrom,
      validUntil: studentConcessions.validUntil,
      notes: studentConcessions.notes,
      approvedByUid: studentConcessions.approvedByUid,
    })
    .from(studentConcessions)
    .leftJoin(feeTypes, eq(feeTypes.id, studentConcessions.appliesToFeeTypeId))
    .where(
      and(
        eq(studentConcessions.locationId, locationId),
        eq(studentConcessions.studentProfileId, studentProfileId),
      ),
    )
    .orderBy(desc(studentConcessions.validFrom));

  if (rows.length === 0) return [];

  // One grouped read for the whole panel rather than one per grant, the same
  // shape `listConcessionSchemes` uses for a scheme's heads.
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
    appliesToFeeTypeNames: heads
      .filter((head) => head.studentConcessionId === row.id)
      .map((head) => head.feeTypeName),
  }));
}

/**
 * One grant, in the shape the calculator prices from.
 *
 * `appliesToFeeTypeIds` is the Sprint 18 head *set*; `appliesToFeeTypeId` is
 * the single-head column every pre-Sprint-18 row still carries. Both are
 * returned and the calculator folds them together, because there is no
 * backfill: a grant written in Sprint 5 must price exactly as it always did.
 * An empty set with a null legacy column means **every head, of every
 * category** — see `concessionHeads` in `lib/fee-calculator.ts`.
 */
export interface ActiveConcessionRow {
  id: string;
  concessionName: string;
  discountType: DiscountType;
  discountValue: string;
  appliesToFeeTypeId: string | null;
  appliesToFeeTypeIds: string[];
}

/** The head sets of many grants at once, keyed by grant id. */
async function headSetsFor(
  concessionIds: readonly string[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (concessionIds.length === 0) return result;

  const rows = await db
    .select({
      studentConcessionId: studentConcessionFeeTypes.studentConcessionId,
      feeTypeId: studentConcessionFeeTypes.feeTypeId,
    })
    .from(studentConcessionFeeTypes)
    .where(inArray(studentConcessionFeeTypes.studentConcessionId, [...concessionIds]));

  for (const row of rows) {
    const heads = result.get(row.studentConcessionId) ?? [];
    heads.push(row.feeTypeId);
    result.set(row.studentConcessionId, heads);
  }

  return result;
}

/**
 * The concessions in force for a student on a given date.
 *
 * A concession is active when the date falls inside its window; an open-ended
 * one (null `valid_until`) never expires. Passing the *billing* date rather
 * than today matters: regenerating June's voucher in August must apply June's
 * discounts, not August's.
 */
export async function listActiveConcessions(
  locationId: string,
  studentProfileId: string,
  onDate: string,
): Promise<ActiveConcessionRow[]> {
  const rows = await db
    .select({
      id: studentConcessions.id,
      concessionName: studentConcessions.concessionName,
      discountType: studentConcessions.discountType,
      discountValue: studentConcessions.discountValue,
      appliesToFeeTypeId: studentConcessions.appliesToFeeTypeId,
    })
    .from(studentConcessions)
    .where(
      and(
        eq(studentConcessions.locationId, locationId),
        eq(studentConcessions.studentProfileId, studentProfileId),
        lte(studentConcessions.validFrom, onDate),
        or(
          isNull(studentConcessions.validUntil),
          gte(studentConcessions.validUntil, onDate),
        ),
      ),
    );

  const heads = await headSetsFor(rows.map((row) => row.id));

  return rows.map((row) => ({ ...row, appliesToFeeTypeIds: heads.get(row.id) ?? [] }));
}

/** Concessions in force for many students at once, keyed by student. */
export async function listActiveConcessionsForStudents(
  locationId: string,
  studentProfileIds: readonly string[],
  onDate: string,
): Promise<Map<string, ActiveConcessionRow[]>> {
  const result = new Map<string, ActiveConcessionRow[]>();

  if (studentProfileIds.length === 0) return result;

  const rows = await db
    .select({
      id: studentConcessions.id,
      studentProfileId: studentConcessions.studentProfileId,
      concessionName: studentConcessions.concessionName,
      discountType: studentConcessions.discountType,
      discountValue: studentConcessions.discountValue,
      appliesToFeeTypeId: studentConcessions.appliesToFeeTypeId,
    })
    .from(studentConcessions)
    .where(
      and(
        eq(studentConcessions.locationId, locationId),
        inArray(studentConcessions.studentProfileId, [...studentProfileIds]),
        lte(studentConcessions.validFrom, onDate),
        or(
          isNull(studentConcessions.validUntil),
          gte(studentConcessions.validUntil, onDate),
        ),
      ),
    );

  const heads = await headSetsFor(rows.map((row) => row.id));

  for (const row of rows) {
    const existing = result.get(row.studentProfileId) ?? [];
    existing.push({
      id: row.id,
      concessionName: row.concessionName,
      discountType: row.discountType,
      discountValue: row.discountValue,
      appliesToFeeTypeId: row.appliesToFeeTypeId,
      appliesToFeeTypeIds: heads.get(row.id) ?? [],
    });
    result.set(row.studentProfileId, existing);
  }

  return result;
}

// -----------------------------------------------------------------------------
// Late fee settings
// -----------------------------------------------------------------------------

export interface LateFeeSettings {
  /** Day of the month monthly challans fall due. */
  dueDay: number;
  /**
   * Whether the school emails its parents this month's open vouchers on a
   * timer. Off until a school turns it on — see `db/schema/late-fee-rules.ts`.
   */
  autoSendVouchers: boolean;
  /** Day of the month that send runs on. */
  autoSendDay: number;
  isEnabled: boolean;
  graceDays: number;
  lateFeeType: LateFeeType;
  lateFeeAmount: string;
  maxLateFee: string | null;
}

/** The 10th, per Sprint 5's decision, until a school configures otherwise. */
export const DEFAULT_DUE_DAY = 10;

/** The school's fee timing policy. Null when it has never been configured. */
export async function getLateFeeRule(
  locationId: string,
): Promise<LateFeeSettings | null> {
  const rows = await db
    .select({
      dueDay: lateFeeRules.dueDay,
      isEnabled: lateFeeRules.isEnabled,
      graceDays: lateFeeRules.graceDays,
      lateFeeType: lateFeeRules.lateFeeType,
      lateFeeAmount: lateFeeRules.lateFeeAmount,
      maxLateFee: lateFeeRules.maxLateFee,
      autoSendVouchers: lateFeeRules.autoSendVouchers,
      autoSendDay: lateFeeRules.autoSendDay,
    })
    .from(lateFeeRules)
    .where(eq(lateFeeRules.locationId, locationId))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * The day of the month challans fall due for this school.
 *
 * Falls back to the platform default rather than failing: a school that has
 * never opened the settings screen still needs its challans dated.
 */
export async function getDueDay(locationId: string): Promise<number> {
  return (await getLateFeeRule(locationId))?.dueDay ?? DEFAULT_DUE_DAY;
}

// -----------------------------------------------------------------------------
// Challans
// -----------------------------------------------------------------------------

export interface ChallanListRow {
  id: string;
  challanNumber: string;
  studentProfileId: string;
  studentName: string;
  studentId: string;
  gradeName: string | null;
  sectionName: string | null;
  billingMonth: number | null;
  billingYear: number | null;
  /**
   * What kind of bill this is, as the register's Kind filter means it.
   *
   * Read for the *label*, not only the filter. Without it a null
   * `billing_month` is the only thing the table can see, and an admission
   * voucher is indistinguishable from a genuine one-off — so filtering by
   * Admission returned four rows whose own Kind column called them One-off.
   */
  challanKind: ChallanKind | null;
  dueDate: string;
  issueDate: string;
  subtotal: string;
  concessionAmount: string;
  /** Credit carried forward this challan spent. `0.00` on almost all of them. */
  creditApplied: string;
  lateFeeAmount: string;
  totalAmount: string;
  paidAmount: string;
  status: ChallanStatus;
}

/**
 * The columns the challan register may be ordered by.
 *
 * `balance` is billed minus paid, computed in the order-by rather than read
 * from a column, because there is no balance column — the same reason the
 * ledger has none. Sorting on it is what answers "who owes the most", which is
 * the question the register is usually opened for.
 */
export const CHALLAN_SORT_COLUMNS = [
  'challanNumber',
  'studentName',
  'totalAmount',
  'paidAmount',
  'balance',
  'status',
  'dueDate',
  'createdAt',
] as const;

export type ChallanSortColumn = (typeof CHALLAN_SORT_COLUMNS)[number];

export interface ListChallansFilters {
  academicYearId?: string | undefined;
  billingMonth?: number | undefined;
  billingYear?: number | undefined;
  kind?: ChallanKindFilter | undefined;
  gradeId?: string | undefined;
  sectionId?: string | undefined;
  status?: string | undefined;
  search?: string | undefined;
  studentProfileId?: string | undefined;
  page?: number | undefined;
  limit?: number | undefined;
  sort?: ChallanSortColumn | undefined;
  direction?: 'asc' | 'desc' | undefined;
}

export interface ListChallansResult {
  challans: ChallanListRow[];
  total: number;
  page: number;
  limit: number;
  /** Totals over every row matching the filter, not just this page. */
  totals: { billed: string; paid: string; balance: string };
}

/**
 * The challan register, filtered and paginated.
 *
 * Grade and section come from the student's enrolment in the voucher's own
 * academic year, so a challan raised last year still shows the class the child
 * was actually in when it was issued.
 */
export async function listChallans(
  locationId: string,
  filters: ListChallansFilters,
): Promise<ListChallansResult> {
  const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);
  const page = Math.max(filters.page ?? 1, 1);

  const conditions: SQL[] = [eq(feeChallans.locationId, locationId)];

  if (filters.academicYearId !== undefined && filters.academicYearId !== '') {
    conditions.push(eq(feeChallans.academicYearId, filters.academicYearId));
  }
  /*
   * The kind filter, and the reason the register needed one.
   *
   * An admission voucher carries a **null** `billing_month` by design — an
   * admission is not a period — so the month filter could never match it and it
   * appeared in no list at all. The register defaulted to the current month, so
   * in practice every admission voucher a school raised was invisible from the
   * moment it was written.
   */
  if (filters.kind === 'monthly') {
    conditions.push(isNotNull(feeChallans.billingMonth));
  } else if (filters.kind === 'one_off') {
    conditions.push(isNull(feeChallans.billingMonth));
    conditions.push(isNull(feeChallans.challanKind));
  } else if (filters.kind === 'admission') {
    conditions.push(eq(feeChallans.challanKind, 'admission'));
  }

  if (filters.billingMonth !== undefined) {
    conditions.push(eq(feeChallans.billingMonth, filters.billingMonth));
  }
  if (filters.billingYear !== undefined) {
    conditions.push(eq(feeChallans.billingYear, filters.billingYear));
  }
  if (filters.studentProfileId !== undefined && filters.studentProfileId !== '') {
    conditions.push(eq(feeChallans.studentProfileId, filters.studentProfileId));
  }
  if (filters.sectionId !== undefined && filters.sectionId !== '') {
    conditions.push(eq(sections.id, filters.sectionId));
  }
  if (filters.gradeId !== undefined && filters.gradeId !== '') {
    conditions.push(eq(sections.gradeId, filters.gradeId));
  }
  // An unrecognised status is dropped rather than rejected: it arrives from a
  // query string, and a stale bookmark should show everything, not 400.
  if (isChallanStatus(filters.status)) {
    conditions.push(eq(feeChallans.status, filters.status));
  }

  const search = (filters.search ?? '').trim();
  if (search !== '') {
    const pattern = `%${search}%`;
    const matches = or(
      ilike(feeChallans.challanNumber, pattern),
      ilike(schoolUsers.name, pattern),
      ilike(studentProfiles.studentId, pattern),
    );
    if (matches !== undefined) conditions.push(matches);
  }

  const where = and(...conditions);

  const order = filters.direction === 'asc' ? asc : desc;
  const sortColumn = {
    challanNumber: feeChallans.challanNumber,
    studentName: schoolUsers.name,
    totalAmount: feeChallans.totalAmount,
    paidAmount: feeChallans.paidAmount,
    balance: sql`${feeChallans.totalAmount} - ${feeChallans.paidAmount}`,
    status: feeChallans.status,
    dueDate: feeChallans.dueDate,
    createdAt: feeChallans.createdAt,
  }[filters.sort ?? 'createdAt'];

  const [rows, totalRows, sums] = await Promise.all([
    challanSelect()
      .where(where)
      .orderBy(order(sortColumn))
      .limit(limit)
      .offset((page - 1) * limit),
    challanCount().where(where),
    challanSums().where(where),
  ]);

  const billedPaise = toPaise(sums[0]?.billed ?? '0');
  const paidPaise = toPaise(sums[0]?.paid ?? '0');

  return {
    challans: rows.map(mapChallanRow),
    total: totalRows[0]?.value ?? 0,
    page,
    limit,
    totals: {
      billed: (billedPaise / 100).toFixed(2),
      paid: (paidPaise / 100).toFixed(2),
      balance: ((billedPaise - paidPaise) / 100).toFixed(2),
    },
  };
}

/**
 * The joins every challan listing needs.
 *
 * The enrolment join is left, and matched on the challan's own academic year:
 * a student whose enrolment was later withdrawn must still appear on the
 * register with their bill, just without a class against it.
 */
function challanSelect() {
  return db
    .select({
      id: feeChallans.id,
      challanNumber: feeChallans.challanNumber,
      studentProfileId: feeChallans.studentProfileId,
      studentName: schoolUsers.name,
      studentId: studentProfiles.studentId,
      gradeName: grades.name,
      gradeDisplayName: grades.displayName,
      sectionName: sections.name,
      billingMonth: feeChallans.billingMonth,
      billingYear: feeChallans.billingYear,
      challanKind: feeChallans.challanKind,
      dueDate: feeChallans.dueDate,
      issueDate: feeChallans.issueDate,
      subtotal: feeChallans.subtotal,
      concessionAmount: feeChallans.concessionAmount,
      creditApplied: feeChallans.creditApplied,
      lateFeeAmount: feeChallans.lateFeeAmount,
      totalAmount: feeChallans.totalAmount,
      paidAmount: feeChallans.paidAmount,
      status: feeChallans.status,
    })
    .from(feeChallans)
    .innerJoin(studentProfiles, eq(studentProfiles.id, feeChallans.studentProfileId))
    .innerJoin(schoolUsers, eq(schoolUsers.id, studentProfiles.schoolUserId))
    .leftJoin(
      studentEnrollments,
      and(
        eq(studentEnrollments.studentProfileId, feeChallans.studentProfileId),
        eq(studentEnrollments.academicYearId, feeChallans.academicYearId),
      ),
    )
    .leftJoin(sections, eq(sections.id, studentEnrollments.sectionId))
    .leftJoin(grades, eq(grades.id, sections.gradeId));
}

function challanCount() {
  return db
    .select({ value: count() })
    .from(feeChallans)
    .innerJoin(studentProfiles, eq(studentProfiles.id, feeChallans.studentProfileId))
    .innerJoin(schoolUsers, eq(schoolUsers.id, studentProfiles.schoolUserId))
    .leftJoin(
      studentEnrollments,
      and(
        eq(studentEnrollments.studentProfileId, feeChallans.studentProfileId),
        eq(studentEnrollments.academicYearId, feeChallans.academicYearId),
      ),
    )
    .leftJoin(sections, eq(sections.id, studentEnrollments.sectionId))
    .leftJoin(grades, eq(grades.id, sections.gradeId));
}

function challanSums() {
  return db
    .select({
      billed: sql<string>`coalesce(sum(${feeChallans.totalAmount}), 0)`,
      paid: sql<string>`coalesce(sum(${feeChallans.paidAmount}), 0)`,
    })
    .from(feeChallans)
    .innerJoin(studentProfiles, eq(studentProfiles.id, feeChallans.studentProfileId))
    .innerJoin(schoolUsers, eq(schoolUsers.id, studentProfiles.schoolUserId))
    .leftJoin(
      studentEnrollments,
      and(
        eq(studentEnrollments.studentProfileId, feeChallans.studentProfileId),
        eq(studentEnrollments.academicYearId, feeChallans.academicYearId),
      ),
    )
    .leftJoin(sections, eq(sections.id, studentEnrollments.sectionId))
    .leftJoin(grades, eq(grades.id, sections.gradeId));
}

interface RawChallanRow {
  id: string;
  challanNumber: string;
  studentProfileId: string;
  studentName: string;
  studentId: string;
  gradeName: string | null;
  gradeDisplayName: string | null;
  sectionName: string | null;
  billingMonth: number | null;
  billingYear: number | null;
  challanKind: ChallanKind | null;
  dueDate: string;
  issueDate: string;
  subtotal: string;
  concessionAmount: string;
  /** Credit carried forward this challan spent. `0.00` on almost all of them. */
  creditApplied: string;
  lateFeeAmount: string;
  totalAmount: string;
  paidAmount: string;
  status: ChallanStatus;
}

function mapChallanRow(row: RawChallanRow): ChallanListRow {
  return {
    id: row.id,
    challanNumber: row.challanNumber,
    studentProfileId: row.studentProfileId,
    studentName: row.studentName,
    studentId: row.studentId,
    gradeName:
      row.gradeName === null
        ? null
        : gradeLabel({ name: row.gradeName, displayName: row.gradeDisplayName }),
    sectionName: row.sectionName,
    billingMonth: row.billingMonth,
    billingYear: row.billingYear,
    challanKind: row.challanKind,
    dueDate: row.dueDate,
    issueDate: row.issueDate,
    subtotal: row.subtotal,
    concessionAmount: row.concessionAmount,
    creditApplied: row.creditApplied,
    lateFeeAmount: row.lateFeeAmount,
    totalAmount: row.totalAmount,
    paidAmount: row.paidAmount,
    status: row.status,
  };
}

export interface ChallanItemRow {
  id: string;
  description: string;
  amount: string;
  concessionAmount: string;
  netAmount: string;
  /**
   * The head's category, read live from `fee_types`.
   *
   * Null once the head has been deleted — the line survives it, carrying its
   * frozen `description`, and the Details line simply drops the category rather
   * than guessing one.
   */
  feeCategory: string | null;
  /** `Sibling Discount 20%`, frozen on the line when the voucher was raised. */
  concessionDetail: string | null;
}

export interface ChallanPaymentRow {
  id: string;
  amount: string;
  paymentMethod: PaymentMethod;
  referenceNumber: string | null;
  paymentDate: string;
  collectedByUid: string;
  collectedByName: string | null;
  notes: string | null;
  createdAt: Date;
}

export interface ChallanDetail extends ChallanListRow {
  academicYearId: string;
  academicYearName: string;
  schoolName: string;
  schoolAddress: string | null;
  schoolPhone: string | null;
  branchName: string | null;
  notes: string | null;
  rollNumber: string | null;
  items: ChallanItemRow[];
  payments: ChallanPaymentRow[];
  guardian: PrimaryGuardian | null;
}

/**
 * One challan with everything the detail and print views need.
 *
 * Deliberately one function rather than three: the print view has to render
 * from a single consistent read, and a slip that showed items from one moment
 * and a paid total from another would be worse than no slip at all.
 */
export async function getChallanDetail(
  locationId: string,
  challanId: string,
): Promise<ChallanDetail | null> {
  const headerRows = await db
    .select({
      id: feeChallans.id,
      challanNumber: feeChallans.challanNumber,
      studentProfileId: feeChallans.studentProfileId,
      studentName: schoolUsers.name,
      studentId: studentProfiles.studentId,
      gradeName: grades.name,
      gradeDisplayName: grades.displayName,
      sectionName: sections.name,
      rollNumber: studentEnrollments.rollNumber,
      billingMonth: feeChallans.billingMonth,
      billingYear: feeChallans.billingYear,
      challanKind: feeChallans.challanKind,
      dueDate: feeChallans.dueDate,
      issueDate: feeChallans.issueDate,
      subtotal: feeChallans.subtotal,
      concessionAmount: feeChallans.concessionAmount,
      creditApplied: feeChallans.creditApplied,
      lateFeeAmount: feeChallans.lateFeeAmount,
      totalAmount: feeChallans.totalAmount,
      paidAmount: feeChallans.paidAmount,
      status: feeChallans.status,
      notes: feeChallans.notes,
      academicYearId: feeChallans.academicYearId,
      academicYearName: academicYears.name,
      schoolName: schools.name,
      schoolAddress: schools.address,
      schoolPhone: schools.phone,
      branchName: branches.name,
    })
    .from(feeChallans)
    .innerJoin(studentProfiles, eq(studentProfiles.id, feeChallans.studentProfileId))
    .innerJoin(schoolUsers, eq(schoolUsers.id, studentProfiles.schoolUserId))
    .innerJoin(academicYears, eq(academicYears.id, feeChallans.academicYearId))
    .innerJoin(schools, eq(schools.locationId, feeChallans.locationId))
    .leftJoin(
      studentEnrollments,
      and(
        eq(studentEnrollments.studentProfileId, feeChallans.studentProfileId),
        eq(studentEnrollments.academicYearId, feeChallans.academicYearId),
      ),
    )
    .leftJoin(sections, eq(sections.id, studentEnrollments.sectionId))
    .leftJoin(grades, eq(grades.id, sections.gradeId))
    .leftJoin(branches, eq(branches.id, grades.branchId))
    .where(and(eq(feeChallans.locationId, locationId), eq(feeChallans.id, challanId)))
    .limit(1);

  const header = headerRows[0];
  if (header === undefined) return null;

  const [items, payments, guardians] = await Promise.all([
    db
      .select({
        id: feeChallanItems.id,
        description: feeChallanItems.description,
        amount: feeChallanItems.amount,
        concessionAmount: feeChallanItems.concessionAmount,
        netAmount: feeChallanItems.netAmount,
        concessionDetail: feeChallanItems.concessionDetail,
        // Live, because `fee_challan_items` has never carried it and a
        // back-filled guess would be a fact about today printed on a slip from
        // February. A deleted head leaves it null and the line says less.
        feeCategory: feeTypes.feeCategory,
      })
      .from(feeChallanItems)
      .leftJoin(feeTypes, eq(feeTypes.id, feeChallanItems.feeTypeId))
      .where(
        and(
          eq(feeChallanItems.locationId, locationId),
          eq(feeChallanItems.challanId, challanId),
        ),
      ),
    db
      .select({
        id: feePayments.id,
        amount: feePayments.amount,
        paymentMethod: feePayments.paymentMethod,
        referenceNumber: feePayments.referenceNumber,
        paymentDate: feePayments.paymentDate,
        collectedByUid: feePayments.collectedByUid,
        collectedByName: schoolUsers.name,
        notes: feePayments.notes,
        createdAt: feePayments.createdAt,
      })
      .from(feePayments)
      .leftJoin(
        schoolUsers,
        and(
          eq(schoolUsers.authUserId, feePayments.collectedByUid),
          eq(schoolUsers.locationId, locationId),
        ),
      )
      .where(
        and(
          eq(feePayments.locationId, locationId),
          eq(feePayments.challanId, challanId),
        ),
      )
      .orderBy(desc(feePayments.paymentDate), desc(feePayments.createdAt)),
    db
      .select({
        name: studentGuardians.name,
        phone: studentGuardians.phone,
        email: studentGuardians.email,
      })
      .from(studentGuardians)
      .where(
        and(
          eq(studentGuardians.locationId, locationId),
          eq(studentGuardians.studentProfileId, header.studentProfileId),
        ),
      )
      .orderBy(desc(studentGuardians.isPrimaryContact))
      .limit(1),
  ]);

  return {
    ...mapChallanRow(header),
    academicYearId: header.academicYearId,
    academicYearName: header.academicYearName,
    schoolName: header.schoolName,
    schoolAddress: header.schoolAddress,
    schoolPhone: header.schoolPhone,
    branchName: header.branchName,
    notes: header.notes,
    rollNumber: header.rollNumber,
    items,
    payments,
    guardian: guardians[0] ?? null,
  };
}

/** The primary guardian's contact details for a set of students. */
/**
 * The contact details a fee notice can travel on.
 *
 * `email` is nullable and often is null — which is the whole reason
 * `/api/school/fees/reminders` counts the guardians it cannot reach. Email is
 * the only channel, so no address means no notice.
 */
export interface PrimaryGuardian {
  name: string;
  phone: string;
  email: string | null;
}

export async function primaryGuardiansFor(
  locationId: string,
  studentProfileIds: readonly string[],
): Promise<Map<string, PrimaryGuardian>> {
  const result = new Map<string, PrimaryGuardian>();
  if (studentProfileIds.length === 0) return result;

  const rows = await db
    .select({
      studentProfileId: studentGuardians.studentProfileId,
      name: studentGuardians.name,
      phone: studentGuardians.phone,
      email: studentGuardians.email,
      isPrimaryContact: studentGuardians.isPrimaryContact,
    })
    .from(studentGuardians)
    .where(
      and(
        eq(studentGuardians.locationId, locationId),
        inArray(studentGuardians.studentProfileId, [...studentProfileIds]),
      ),
    )
    .orderBy(desc(studentGuardians.isPrimaryContact));

  for (const row of rows) {
    // Ordered primary-first, so the first row seen for a student is the one
    // the school wants contacted.
    if (!result.has(row.studentProfileId)) {
      result.set(row.studentProfileId, {
        name: row.name,
        phone: row.phone,
        email: row.email,
      });
    }
  }

  return result;
}

// -----------------------------------------------------------------------------
// Overview statistics
// -----------------------------------------------------------------------------

export interface FeeOverview {
  /** PKR collected in the current calendar month. */
  collectedThisMonth: string;
  /** PKR still owed on challans billed for the current month. */
  outstandingThisMonth: string;
  /** Challans past their due date and not settled. */
  overdueCount: number;
  /** Students holding at least one concession that is in force today. */
  studentsWithConcessions: number;
  /** Whether any fee head has been set up yet — drives the setup banner. */
  hasFeeTypes: boolean;
}

export async function getFeeOverview(locationId: string): Promise<FeeOverview> {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const today = toDateOnly(now);
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const nextMonthStart =
    month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;

  const [collected, outstanding, overdue, concessions, types] = await Promise.all([
    db
      .select({ value: sql<string>`coalesce(sum(${feePayments.amount}), 0)` })
      .from(feePayments)
      .where(
        and(
          eq(feePayments.locationId, locationId),
          gte(feePayments.paymentDate, monthStart),
          lt(feePayments.paymentDate, nextMonthStart),
        ),
      ),
    db
      .select({
        value: sql<string>`coalesce(sum(${feeChallans.totalAmount} - ${feeChallans.paidAmount}), 0)`,
      })
      .from(feeChallans)
      .where(
        and(
          eq(feeChallans.locationId, locationId),
          eq(feeChallans.billingMonth, month),
          eq(feeChallans.billingYear, year),
          inArray(feeChallans.status, ['unpaid', 'partial']),
        ),
      ),
    db
      .select({ value: count() })
      .from(feeChallans)
      .where(
        and(
          eq(feeChallans.locationId, locationId),
          lt(feeChallans.dueDate, today),
          inArray(feeChallans.status, ['unpaid', 'partial']),
        ),
      ),
    db
      .select({
        value: sql<number>`count(distinct ${studentConcessions.studentProfileId})`.mapWith(
          Number,
        ),
      })
      .from(studentConcessions)
      .where(
        and(
          eq(studentConcessions.locationId, locationId),
          lte(studentConcessions.validFrom, today),
          or(
            isNull(studentConcessions.validUntil),
            gte(studentConcessions.validUntil, today),
          ),
        ),
      ),
    db
      .select({ value: count() })
      .from(feeTypes)
      .where(eq(feeTypes.locationId, locationId)),
  ]);

  return {
    collectedThisMonth: collected[0]?.value ?? '0',
    outstandingThisMonth: outstanding[0]?.value ?? '0',
    overdueCount: overdue[0]?.value ?? 0,
    studentsWithConcessions: concessions[0]?.value ?? 0,
    hasFeeTypes: (types[0]?.value ?? 0) > 0,
  };
}

/** `Date` -> `YYYY-MM-DD` in local time, which is what a DATE column holds. */
export function toDateOnly(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// -----------------------------------------------------------------------------
// Reports
// -----------------------------------------------------------------------------

export interface OutstandingRow {
  challanId: string;
  challanNumber: string;
  studentProfileId: string;
  studentName: string;
  studentId: string;
  gradeName: string | null;
  sectionName: string | null;
  billingMonth: number | null;
  billingYear: number | null;
  dueDate: string;
  totalAmount: string;
  paidAmount: string;
  balance: string;
  daysOverdue: number;
  guardianName: string | null;
  guardianPhone: string | null;
}

export interface OutstandingFilters {
  gradeId?: string | undefined;
  sectionId?: string | undefined;
  billingMonth?: number | undefined;
  billingYear?: number | undefined;
  academicYearId?: string | undefined;
  /** Only challans at least this many days past due. */
  minDaysOverdue?: number | undefined;
  limit?: number | undefined;
}

/**
 * Unpaid and partly-paid challans, most overdue first.
 *
 * Backs both the outstanding-fees report and the defaulters list — they differ
 * only in `minDaysOverdue`, so they share one query rather than drifting apart.
 */
export async function listOutstandingChallans(
  locationId: string,
  filters: OutstandingFilters,
): Promise<OutstandingRow[]> {
  const today = toDateOnly(new Date());
  const conditions: SQL[] = [
    eq(feeChallans.locationId, locationId),
    inArray(feeChallans.status, ['unpaid', 'partial']),
  ];

  if (filters.academicYearId !== undefined && filters.academicYearId !== '') {
    conditions.push(eq(feeChallans.academicYearId, filters.academicYearId));
  }
  if (filters.billingMonth !== undefined) {
    conditions.push(eq(feeChallans.billingMonth, filters.billingMonth));
  }
  if (filters.billingYear !== undefined) {
    conditions.push(eq(feeChallans.billingYear, filters.billingYear));
  }
  if (filters.sectionId !== undefined && filters.sectionId !== '') {
    conditions.push(eq(sections.id, filters.sectionId));
  }
  if (filters.gradeId !== undefined && filters.gradeId !== '') {
    conditions.push(eq(sections.gradeId, filters.gradeId));
  }

  const minDays = filters.minDaysOverdue ?? 0;
  if (minDays > 0) {
    // Compared in SQL rather than in JS so the "30 days overdue" cut is applied
    // before the limit, not after it.
    conditions.push(
      sql`${feeChallans.dueDate} < (${today}::date - ${minDays}::integer)`,
    );
  }

  const rows = await challanSelect()
    .where(and(...conditions))
    .orderBy(asc(feeChallans.dueDate))
    .limit(Math.min(Math.max(filters.limit ?? 200, 1), 500));

  const guardians = await primaryGuardiansFor(
    locationId,
    rows.map((row) => row.studentProfileId),
  );

  const asOf = new Date();

  return rows.map((row) => {
    const mapped = mapChallanRow(row);
    const guardian = guardians.get(row.studentProfileId) ?? null;

    return {
      challanId: mapped.id,
      challanNumber: mapped.challanNumber,
      studentProfileId: mapped.studentProfileId,
      studentName: mapped.studentName,
      studentId: mapped.studentId,
      gradeName: mapped.gradeName,
      sectionName: mapped.sectionName,
      billingMonth: mapped.billingMonth,
      billingYear: mapped.billingYear,
      dueDate: mapped.dueDate,
      totalAmount: mapped.totalAmount,
      paidAmount: mapped.paidAmount,
      balance: remainingBalance(mapped.totalAmount, mapped.paidAmount).toFixed(2),
      daysOverdue: daysOverdue(mapped.dueDate, asOf),
      guardianName: guardian?.name ?? null,
      guardianPhone: guardian?.phone ?? null,
    };
  });
}

export interface CollectionMonthRow {
  month: number;
  year: number;
  collected: string;
  paymentCount: number;
}

/**
 * Money received per calendar month over a date range.
 *
 * Grouped by *payment* date rather than billing month, because this answers
 * "what did we take in March", which includes March payments against January
 * challans.
 */
export async function getCollectionSummary(
  locationId: string,
  fromDate: string,
  toDate: string,
): Promise<CollectionMonthRow[]> {
  const rows = await db
    .select({
      month: sql<number>`extract(month from ${feePayments.paymentDate})`.mapWith(Number),
      year: sql<number>`extract(year from ${feePayments.paymentDate})`.mapWith(Number),
      collected: sql<string>`coalesce(sum(${feePayments.amount}), 0)`,
      paymentCount: count(),
    })
    .from(feePayments)
    .where(
      and(
        eq(feePayments.locationId, locationId),
        gte(feePayments.paymentDate, fromDate),
        lte(feePayments.paymentDate, toDate),
      ),
    )
    .groupBy(
      sql`extract(year from ${feePayments.paymentDate})`,
      sql`extract(month from ${feePayments.paymentDate})`,
    )
    .orderBy(
      sql`extract(year from ${feePayments.paymentDate}) desc`,
      sql`extract(month from ${feePayments.paymentDate}) desc`,
    );

  return rows;
}

// -----------------------------------------------------------------------------
// Credit carried forward (Sprint 17)
// -----------------------------------------------------------------------------

/**
 * What one student's credit balance is, in integer paise.
 *
 * `SUM(amount)` over an append-only table, exactly as a ledger balance is read.
 * There is no balance column and there must not be one — see the docstring on
 * `db/schema/student-credits.ts`.
 *
 * Floored at zero for callers. A negative sum would mean more credit has been
 * spent than was ever granted, which no code path can produce; if one ever
 * does, the answer a challan needs is "there is nothing to spend", not a
 * surcharge invented out of an accounting bug.
 *
 * @param runner  Pass the transaction handle when the balance is being read
 *   inside the same transaction that is about to spend it. A builder made from
 *   `db` runs outside the transaction even when awaited inside one.
 */
export async function getCreditBalancePaise(
  locationId: string,
  studentProfileId: string,
  runner: Database | Tx = db,
): Promise<number> {
  const rows = await runner
    .select({ amount: studentCredits.amount })
    .from(studentCredits)
    .where(
      and(
        eq(studentCredits.locationId, locationId),
        eq(studentCredits.studentProfileId, studentProfileId),
      ),
    );

  let balancePaise = 0;
  for (const row of rows) balancePaise += toPaise(row.amount);

  return Math.max(balancePaise, 0);
}

export interface StudentCreditRow {
  id: string;
  amount: string;
  reason: CreditReason;
  notes: string | null;
  createdAt: Date;
  /** The challan whose repricing granted it, when there was one. */
  sourceChallanId: string | null;
  sourceChallanNumber: string | null;
  /** The challan that spent it, on a consuming row. */
  appliedChallanId: string | null;
  appliedChallanNumber: string | null;
}

export interface StudentCreditHistory {
  /** PKR, floored at zero — the same figure `getCreditBalancePaise` returns. */
  balance: string;
  entries: StudentCreditRow[];
}

/**
 * Every credit movement for one student, newest first, with the challan
 * numbers on both sides resolved.
 *
 * The profile card and the challan detail page both render this. A credit
 * nobody can see is a credit nobody trusts, and a parent asking "where did my
 * discount go" has to be answerable with a challan number rather than a
 * balance.
 */
export async function getStudentCreditHistory(
  locationId: string,
  studentProfileId: string,
): Promise<StudentCreditHistory> {
  const sourceChallans = alias(feeChallans, 'source_challan');
  const appliedChallans = alias(feeChallans, 'applied_challan');

  const rows = await db
    .select({
      id: studentCredits.id,
      amount: studentCredits.amount,
      reason: studentCredits.reason,
      notes: studentCredits.notes,
      createdAt: studentCredits.createdAt,
      sourceChallanId: studentCredits.sourceChallanId,
      sourceChallanNumber: sourceChallans.challanNumber,
      appliedChallanId: studentCredits.appliedChallanId,
      appliedChallanNumber: appliedChallans.challanNumber,
    })
    .from(studentCredits)
    .leftJoin(sourceChallans, eq(sourceChallans.id, studentCredits.sourceChallanId))
    .leftJoin(appliedChallans, eq(appliedChallans.id, studentCredits.appliedChallanId))
    .where(
      and(
        eq(studentCredits.locationId, locationId),
        eq(studentCredits.studentProfileId, studentProfileId),
      ),
    )
    .orderBy(desc(studentCredits.createdAt));

  let balancePaise = 0;
  for (const row of rows) balancePaise += toPaise(row.amount);

  return {
    balance: (Math.max(balancePaise, 0) / 100).toFixed(2),
    entries: rows,
  };
}

// -----------------------------------------------------------------------------
// Portal reads (parent and student)
// -----------------------------------------------------------------------------

export interface StudentFeeSummary {
  billed: string;
  paid: string;
  balance: string;
  /** The oldest challan still owing, which is the one to chase. */
  oldestUnpaid: {
    id: string;
    challanNumber: string;
    dueDate: string;
    balance: string;
    billingMonth: number | null;
    billingYear: number | null;
  } | null;
}

/**
 * What one student owes overall.
 *
 * Cancelled and waived challans are excluded from every figure: they are
 * decisions the school already made, and carrying them into a parent's balance
 * would show a debt that does not exist.
 */
export async function getStudentFeeSummary(
  locationId: string,
  studentProfileId: string,
): Promise<StudentFeeSummary> {
  const rows = await db
    .select({
      id: feeChallans.id,
      challanNumber: feeChallans.challanNumber,
      dueDate: feeChallans.dueDate,
      totalAmount: feeChallans.totalAmount,
      paidAmount: feeChallans.paidAmount,
      status: feeChallans.status,
      billingMonth: feeChallans.billingMonth,
      billingYear: feeChallans.billingYear,
    })
    .from(feeChallans)
    .where(
      and(
        eq(feeChallans.locationId, locationId),
        eq(feeChallans.studentProfileId, studentProfileId),
        inArray(feeChallans.status, ['unpaid', 'partial', 'paid']),
      ),
    )
    .orderBy(asc(feeChallans.dueDate));

  let billedPaise = 0;
  let paidPaise = 0;
  let oldestUnpaid: StudentFeeSummary['oldestUnpaid'] = null;

  for (const row of rows) {
    billedPaise += toPaise(row.totalAmount);
    paidPaise += toPaise(row.paidAmount);

    const balance = toPaise(row.totalAmount) - toPaise(row.paidAmount);
    if (balance > 0 && oldestUnpaid === null) {
      oldestUnpaid = {
        id: row.id,
        challanNumber: row.challanNumber,
        dueDate: row.dueDate,
        balance: (balance / 100).toFixed(2),
        billingMonth: row.billingMonth,
        billingYear: row.billingYear,
      };
    }
  }

  return {
    billed: (billedPaise / 100).toFixed(2),
    paid: (paidPaise / 100).toFixed(2),
    balance: (Math.max(billedPaise - paidPaise, 0) / 100).toFixed(2),
    oldestUnpaid,
  };
}

/** Every challan for one student, newest first — the portal's history table. */
export async function listStudentChallans(
  locationId: string,
  studentProfileId: string,
): Promise<ChallanListRow[]> {
  const rows = await challanSelect()
    .where(
      and(
        eq(feeChallans.locationId, locationId),
        eq(feeChallans.studentProfileId, studentProfileId),
      ),
    )
    .orderBy(desc(feeChallans.issueDate), desc(feeChallans.createdAt));

  return rows.map(mapChallanRow);
}

/**
 * True when this student profile is one of the guardian's own children.
 *
 * The parent portal's authorisation check. Everything a parent reads about a
 * child goes through it, so a `?child=` or a challan id from another family
 * resolves to nothing rather than to somebody else's bill.
 */
export async function guardianOwnsStudent(
  locationId: string,
  guardianSchoolUserId: string,
  studentProfileId: string,
): Promise<boolean> {
  const rows = await db
    .select({ value: count() })
    .from(studentGuardians)
    .where(
      and(
        eq(studentGuardians.locationId, locationId),
        eq(studentGuardians.schoolUserId, guardianSchoolUserId),
        eq(studentGuardians.studentProfileId, studentProfileId),
      ),
    );

  return (rows[0]?.value ?? 0) > 0;
}

/**
 * How much money this school has taken against one student, as a count of
 * receipts.
 *
 * ── Why it is a count and not a boolean ──────────────────────────────────
 * Its one caller is `DELETE /api/school/students/[studentId]`, and the number
 * goes into the refusal: "has 3 payments recorded against their vouchers" is a
 * sentence a clerk can check, where "cannot be deleted" invites a second and a
 * third attempt at the same button.
 *
 * Joined through `fee_challans` rather than read from a student column, because
 * `fee_payments` has no student of its own — a payment is made against a bill,
 * which is the only relationship that survives a family voucher clubbing four
 * children's bills together.
 */
export async function countPaymentsForStudent(
  locationId: string,
  studentProfileId: string,
): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(feePayments)
    .innerJoin(feeChallans, eq(feeChallans.id, feePayments.challanId))
    .where(
      and(
        eq(feePayments.locationId, locationId),
        eq(feeChallans.locationId, locationId),
        eq(feeChallans.studentProfileId, studentProfileId),
      ),
    );

  return rows[0]?.value ?? 0;
}
