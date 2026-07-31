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
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';

import {
  academicYears,
  branches,
  feeChallanItems,
  feeChallans,
  feePayments,
  feeStructures,
  feeTypes,
  grades,
  gradeLabel,
  lateFeeRules,
  schoolUsers,
  sections,
  studentConcessions,
  studentEnrollments,
  studentGuardians,
  studentProfiles,
  isChallanStatus,
  OUTSTANDING_CHALLAN_STATUSES,
  type ChallanStatus,
  type DiscountType,
  type FeeCategory,
  type LateFeeRule,
  type PaymentMethod,
} from '@/db/schema';

import { db } from './drizzle';
import { daysOverdue } from './fee-calculator';
import { paiseOrZero, type Paise } from './money';

/**
 * Tenant-scoped reads for the Fee Management module.
 *
 * Same contract as the rest of the platform: every function takes `locationId`
 * first and filters on it, and that value must have come from verified session
 * claims.
 *
 * Money leaves this module as integer paise, never as a float. Callers format
 * it with `lib/money.ts`.
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
  options: { activeOnly?: boolean } = {},
): Promise<FeeTypeRow[]> {
  const conditions: SQL[] = [eq(feeTypes.locationId, locationId)];
  if (options.activeOnly === true) conditions.push(eq(feeTypes.isActive, true));

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
  typeId: string,
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
    .where(and(eq(feeTypes.locationId, locationId), eq(feeTypes.id, typeId)))
    .limit(1);

  return rows[0] ?? null;
}

// -----------------------------------------------------------------------------
// Fee structures
// -----------------------------------------------------------------------------

export interface FeeStructureMatrix {
  feeTypes: FeeTypeRow[];
  grades: Array<{
    gradeId: string;
    gradeName: string;
    sortOrder: number;
    /** Keyed by fee type id. Absent means "not charged". */
    amounts: Record<string, string>;
  }>;
}

/**
 * The setup matrix: grades down the side, fee heads across the top.
 *
 * A missing cell is meaningfully different from a zero one — it means the grade
 * is not charged that head at all — so amounts come back as a sparse record
 * rather than a dense grid of zeroes.
 */
export async function getFeeStructureMatrix(
  locationId: string,
  branchId: string,
  academicYearId: string,
): Promise<FeeStructureMatrix> {
  const [types, gradeRows, structureRows] = await Promise.all([
    listFeeTypes(locationId, { activeOnly: true }),
    db
      .select({
        id: grades.id,
        name: grades.name,
        displayName: grades.displayName,
        sortOrder: grades.sortOrder,
      })
      .from(grades)
      .where(
        and(
          eq(grades.locationId, locationId),
          eq(grades.branchId, branchId),
          eq(grades.isActive, true),
        ),
      )
      .orderBy(asc(grades.sortOrder)),
    db
      .select({
        gradeId: feeStructures.gradeId,
        feeTypeId: feeStructures.feeTypeId,
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

  const byGrade = new Map<string, Record<string, string>>();
  for (const row of structureRows) {
    const existing = byGrade.get(row.gradeId) ?? {};
    existing[row.feeTypeId] = row.amount;
    byGrade.set(row.gradeId, existing);
  }

  return {
    feeTypes: types,
    grades: gradeRows.map((grade) => ({
      gradeId: grade.id,
      gradeName: gradeLabel(grade),
      sortOrder: grade.sortOrder,
      amounts: byGrade.get(grade.id) ?? {},
    })),
  };
}

// -----------------------------------------------------------------------------
// Concessions
// -----------------------------------------------------------------------------

export interface ConcessionRow {
  id: string;
  concessionName: string;
  discountType: DiscountType;
  discountValue: string;
  appliesToFeeTypeId: string | null;
  appliesToFeeTypeName: string | null;
  validFrom: string;
  validUntil: string | null;
  notes: string | null;
}

export async function listConcessions(
  locationId: string,
  studentProfileId: string,
): Promise<ConcessionRow[]> {
  return db
    .select({
      id: studentConcessions.id,
      concessionName: studentConcessions.concessionName,
      discountType: studentConcessions.discountType,
      discountValue: studentConcessions.discountValue,
      appliesToFeeTypeId: studentConcessions.appliesToFeeTypeId,
      appliesToFeeTypeName: feeTypes.name,
      validFrom: studentConcessions.validFrom,
      validUntil: studentConcessions.validUntil,
      notes: studentConcessions.notes,
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
}

// -----------------------------------------------------------------------------
// Settings
// -----------------------------------------------------------------------------

export async function getLateFeeRule(
  locationId: string,
): Promise<LateFeeRule | null> {
  const rows = await db
    .select()
    .from(lateFeeRules)
    .where(eq(lateFeeRules.locationId, locationId))
    .limit(1);

  return rows[0] ?? null;
}

// -----------------------------------------------------------------------------
// Challans
// -----------------------------------------------------------------------------

export interface ChallanRow {
  id: string;
  challanNumber: string;
  studentProfileId: string;
  studentName: string;
  studentId: string;
  gradeName: string;
  sectionName: string;
  billingMonth: number | null;
  billingYear: number | null;
  dueDate: string;
  issueDate: string;
  totalPaise: Paise;
  paidPaise: Paise;
  balancePaise: Paise;
  status: ChallanStatus;
  daysOverdue: number;
}

export interface ListChallansFilters {
  status?: string | undefined;
  gradeId?: string | undefined;
  sectionId?: string | undefined;
  billingMonth?: number | undefined;
  billingYear?: number | undefined;
  academicYearId?: string | undefined;
  studentProfileId?: string | undefined;
  search?: string | undefined;
  page?: number | undefined;
  limit?: number | undefined;
}

export interface ListChallansResult {
  challans: ChallanRow[];
  total: number;
  page: number;
  limit: number;
  /** Sum of `total_amount` across the whole filter, not just this page. */
  filteredTotalPaise: Paise;
  filteredPaidPaise: Paise;
}

function challanConditions(
  locationId: string,
  filters: ListChallansFilters,
): SQL[] {
  const conditions: SQL[] = [eq(feeChallans.locationId, locationId)];

  if (isChallanStatus(filters.status)) {
    conditions.push(eq(feeChallans.status, filters.status));
  }
  if (filters.gradeId !== undefined && filters.gradeId !== '') {
    conditions.push(eq(sections.gradeId, filters.gradeId));
  }
  if (filters.sectionId !== undefined && filters.sectionId !== '') {
    conditions.push(eq(studentEnrollments.sectionId, filters.sectionId));
  }
  if (filters.billingMonth !== undefined && Number.isInteger(filters.billingMonth)) {
    conditions.push(eq(feeChallans.billingMonth, filters.billingMonth));
  }
  if (filters.billingYear !== undefined && Number.isInteger(filters.billingYear)) {
    conditions.push(eq(feeChallans.billingYear, filters.billingYear));
  }
  if (filters.academicYearId !== undefined && filters.academicYearId !== '') {
    conditions.push(eq(feeChallans.academicYearId, filters.academicYearId));
  }
  if (filters.studentProfileId !== undefined && filters.studentProfileId !== '') {
    conditions.push(eq(feeChallans.studentProfileId, filters.studentProfileId));
  }

  const search = (filters.search ?? '').trim();
  if (search !== '') {
    const pattern = `%${search}%`;
    const matches = or(
      ilike(schoolUsers.name, pattern),
      ilike(feeChallans.challanNumber, pattern),
      ilike(studentProfiles.studentId, pattern),
    );
    if (matches !== undefined) conditions.push(matches);
  }

  return conditions;
}

/**
 * The challan register.
 *
 * Joined through the student's enrolment so a challan can be filtered by grade
 * and section — the two things an admin actually filters by. The enrolment is
 * matched on the challan's own academic year, so a student who has since moved
 * up still appears under the class they were billed in.
 */
export async function listChallans(
  locationId: string,
  filters: ListChallansFilters,
): Promise<ListChallansResult> {
  const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);
  const page = Math.max(filters.page ?? 1, 1);

  const conditions = challanConditions(locationId, filters);
  const where = and(...conditions);

  const base = db
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
      dueDate: feeChallans.dueDate,
      issueDate: feeChallans.issueDate,
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

  const totalsQuery = db
    .select({
      value: count(),
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
    .where(where);

  const [rows, totals] = await Promise.all([
    base
      .where(where)
      .orderBy(desc(feeChallans.issueDate), asc(schoolUsers.name))
      .limit(limit)
      .offset((page - 1) * limit),
    totalsQuery,
  ]);

  const challans: ChallanRow[] = rows.map((row) => {
    const totalPaise = paiseOrZero(row.totalAmount);
    const paidPaise = paiseOrZero(row.paidAmount);

    return {
      id: row.id,
      challanNumber: row.challanNumber,
      studentProfileId: row.studentProfileId,
      studentName: row.studentName,
      studentId: row.studentId,
      gradeName:
        row.gradeName === null
          ? '—'
          : gradeLabel({ name: row.gradeName, displayName: row.gradeDisplayName }),
      sectionName: row.sectionName ?? '—',
      billingMonth: row.billingMonth,
      billingYear: row.billingYear,
      dueDate: row.dueDate,
      issueDate: row.issueDate,
      totalPaise,
      paidPaise,
      balancePaise: Math.max(totalPaise - paidPaise, 0),
      status: row.status,
      daysOverdue:
        row.status === 'unpaid' || row.status === 'partial'
          ? daysOverdue(row.dueDate)
          : 0,
    };
  });

  return {
    challans,
    total: totals[0]?.value ?? 0,
    page,
    limit,
    filteredTotalPaise: paiseOrZero(totals[0]?.billed),
    filteredPaidPaise: paiseOrZero(totals[0]?.paid),
  };
}

export interface ChallanItemRow {
  id: string;
  description: string;
  amountPaise: Paise;
  concessionPaise: Paise;
  netPaise: Paise;
}

export interface PaymentRow {
  id: string;
  amountPaise: Paise;
  paymentMethod: PaymentMethod;
  referenceNumber: string | null;
  paymentDate: string;
  collectedByUid: string;
  notes: string | null;
}

export interface ChallanDetail extends ChallanRow {
  academicYearId: string;
  academicYearName: string;
  subtotalPaise: Paise;
  concessionPaise: Paise;
  lateFeePaise: Paise;
  notes: string | null;
  branchName: string | null;
  items: ChallanItemRow[];
  payments: PaymentRow[];
  guardianName: string | null;
  guardianPhone: string | null;
}

export async function getChallanDetail(
  locationId: string,
  challanId: string,
): Promise<ChallanDetail | null> {
  const rows = await db
    .select({
      id: feeChallans.id,
      challanNumber: feeChallans.challanNumber,
      studentProfileId: feeChallans.studentProfileId,
      studentName: schoolUsers.name,
      studentId: studentProfiles.studentId,
      academicYearId: feeChallans.academicYearId,
      academicYearName: academicYears.name,
      gradeName: grades.name,
      gradeDisplayName: grades.displayName,
      sectionName: sections.name,
      branchName: branches.name,
      billingMonth: feeChallans.billingMonth,
      billingYear: feeChallans.billingYear,
      dueDate: feeChallans.dueDate,
      issueDate: feeChallans.issueDate,
      subtotal: feeChallans.subtotal,
      concessionAmount: feeChallans.concessionAmount,
      lateFeeAmount: feeChallans.lateFeeAmount,
      totalAmount: feeChallans.totalAmount,
      paidAmount: feeChallans.paidAmount,
      status: feeChallans.status,
      notes: feeChallans.notes,
    })
    .from(feeChallans)
    .innerJoin(studentProfiles, eq(studentProfiles.id, feeChallans.studentProfileId))
    .innerJoin(schoolUsers, eq(schoolUsers.id, studentProfiles.schoolUserId))
    .innerJoin(academicYears, eq(academicYears.id, feeChallans.academicYearId))
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

  const row = rows[0];
  if (row === undefined) return null;

  const [itemRows, paymentRows, guardianRows] = await Promise.all([
    db
      .select({
        id: feeChallanItems.id,
        description: feeChallanItems.description,
        amount: feeChallanItems.amount,
        concessionAmount: feeChallanItems.concessionAmount,
        netAmount: feeChallanItems.netAmount,
      })
      .from(feeChallanItems)
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
        notes: feePayments.notes,
      })
      .from(feePayments)
      .where(
        and(
          eq(feePayments.locationId, locationId),
          eq(feePayments.challanId, challanId),
        ),
      )
      .orderBy(desc(feePayments.paymentDate)),
    db
      .select({
        name: studentGuardians.name,
        phone: studentGuardians.phone,
        isPrimary: studentGuardians.isPrimaryContact,
      })
      .from(studentGuardians)
      .where(
        and(
          eq(studentGuardians.locationId, locationId),
          eq(studentGuardians.studentProfileId, row.studentProfileId),
        ),
      )
      .orderBy(desc(studentGuardians.isPrimaryContact)),
  ]);

  const totalPaise = paiseOrZero(row.totalAmount);
  const paidPaise = paiseOrZero(row.paidAmount);
  const guardian = guardianRows[0];

  return {
    id: row.id,
    challanNumber: row.challanNumber,
    studentProfileId: row.studentProfileId,
    studentName: row.studentName,
    studentId: row.studentId,
    academicYearId: row.academicYearId,
    academicYearName: row.academicYearName,
    gradeName:
      row.gradeName === null
        ? '—'
        : gradeLabel({ name: row.gradeName, displayName: row.gradeDisplayName }),
    sectionName: row.sectionName ?? '—',
    branchName: row.branchName,
    billingMonth: row.billingMonth,
    billingYear: row.billingYear,
    dueDate: row.dueDate,
    issueDate: row.issueDate,
    subtotalPaise: paiseOrZero(row.subtotal),
    concessionPaise: paiseOrZero(row.concessionAmount),
    lateFeePaise: paiseOrZero(row.lateFeeAmount),
    totalPaise,
    paidPaise,
    balancePaise: Math.max(totalPaise - paidPaise, 0),
    status: row.status,
    notes: row.notes,
    daysOverdue:
      row.status === 'unpaid' || row.status === 'partial'
        ? daysOverdue(row.dueDate)
        : 0,
    items: itemRows.map((item) => ({
      id: item.id,
      description: item.description,
      amountPaise: paiseOrZero(item.amount),
      concessionPaise: paiseOrZero(item.concessionAmount),
      netPaise: paiseOrZero(item.netAmount),
    })),
    payments: paymentRows.map((payment) => ({
      id: payment.id,
      amountPaise: paiseOrZero(payment.amount),
      paymentMethod: payment.paymentMethod,
      referenceNumber: payment.referenceNumber,
      paymentDate: payment.paymentDate,
      collectedByUid: payment.collectedByUid,
      notes: payment.notes,
    })),
    guardianName: guardian?.name ?? null,
    guardianPhone: guardian?.phone ?? null,
  };
}

// -----------------------------------------------------------------------------
// Overview and reports
// -----------------------------------------------------------------------------

/** First and last day of the current month, as `YYYY-MM-DD`. */
function currentMonthRange(): { start: string; end: string; month: number; year: number } {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return {
    start: `${year}-${String(month).padStart(2, '0')}-01`,
    end: `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
    month,
    year,
  };
}

export interface FeeOverview {
  collectedThisMonthPaise: Paise;
  outstandingThisMonthPaise: Paise;
  overdueChallanCount: number;
  activeConcessionCount: number;
  currentMonth: number;
  currentYear: number;
}

export async function getFeeOverview(locationId: string): Promise<FeeOverview> {
  const period = currentMonthRange();
  const today = new Date().toISOString().slice(0, 10);

  const [collected, outstanding, overdue, concessions] = await Promise.all([
    db
      .select({ value: sql<string>`coalesce(sum(${feePayments.amount}), 0)` })
      .from(feePayments)
      .where(
        and(
          eq(feePayments.locationId, locationId),
          gte(feePayments.paymentDate, period.start),
          lte(feePayments.paymentDate, period.end),
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
          eq(feeChallans.billingMonth, period.month),
          eq(feeChallans.billingYear, period.year),
          inArray(feeChallans.status, [...OUTSTANDING_CHALLAN_STATUSES]),
        ),
      ),
    db
      .select({ value: count() })
      .from(feeChallans)
      .where(
        and(
          eq(feeChallans.locationId, locationId),
          lte(feeChallans.dueDate, today),
          inArray(feeChallans.status, [...OUTSTANDING_CHALLAN_STATUSES]),
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
          or(
            sql`${studentConcessions.validUntil} is null`,
            gte(studentConcessions.validUntil, today),
          ),
        ),
      ),
  ]);

  return {
    collectedThisMonthPaise: paiseOrZero(collected[0]?.value),
    outstandingThisMonthPaise: paiseOrZero(outstanding[0]?.value),
    overdueChallanCount: overdue[0]?.value ?? 0,
    activeConcessionCount: concessions[0]?.value ?? 0,
    currentMonth: period.month,
    currentYear: period.year,
  };
}

export interface OutstandingRow extends ChallanRow {
  guardianPhone: string | null;
}

/** Unpaid and partly-paid challans, worst overdue first. */
export async function listOutstanding(
  locationId: string,
  filters: ListChallansFilters,
): Promise<OutstandingRow[]> {
  const result = await listChallans(locationId, {
    ...filters,
    status: undefined,
    limit: 200,
    page: 1,
  });

  const outstanding = result.challans.filter((challan) =>
    (OUTSTANDING_CHALLAN_STATUSES as readonly string[]).includes(challan.status),
  );

  if (outstanding.length === 0) return [];

  const guardianRows = await db
    .select({
      studentProfileId: studentGuardians.studentProfileId,
      phone: studentGuardians.phone,
      isPrimary: studentGuardians.isPrimaryContact,
    })
    .from(studentGuardians)
    .where(
      and(
        eq(studentGuardians.locationId, locationId),
        inArray(
          studentGuardians.studentProfileId,
          outstanding.map((challan) => challan.studentProfileId),
        ),
      ),
    )
    .orderBy(desc(studentGuardians.isPrimaryContact));

  const phoneByStudent = new Map<string, string>();
  for (const row of guardianRows) {
    if (!phoneByStudent.has(row.studentProfileId)) {
      phoneByStudent.set(row.studentProfileId, row.phone);
    }
  }

  return outstanding
    .map((challan) => ({
      ...challan,
      guardianPhone: phoneByStudent.get(challan.studentProfileId) ?? null,
    }))
    .sort((left, right) => right.daysOverdue - left.daysOverdue);
}

export interface CollectionPeriod {
  billingMonth: number;
  billingYear: number;
  billedPaise: Paise;
  collectedPaise: Paise;
  outstandingPaise: Paise;
  /** 0-100, rounded to one decimal. */
  collectionRate: number;
}

/**
 * Billed against collected, by billing month.
 *
 * "Collected" is the paid amount recorded against challans *for that month*,
 * not payments received during it — a family settling June's bill in August
 * belongs to June's collection rate, which is the number a school actually
 * wants when judging a month.
 */
export async function getCollectionSummary(
  locationId: string,
  params: { academicYearId?: string | undefined },
): Promise<CollectionPeriod[]> {
  const conditions: SQL[] = [eq(feeChallans.locationId, locationId)];
  if (params.academicYearId !== undefined && params.academicYearId !== '') {
    conditions.push(eq(feeChallans.academicYearId, params.academicYearId));
  }

  const rows = await db
    .select({
      billingMonth: feeChallans.billingMonth,
      billingYear: feeChallans.billingYear,
      billed: sql<string>`coalesce(sum(${feeChallans.totalAmount}), 0)`,
      collected: sql<string>`coalesce(sum(${feeChallans.paidAmount}), 0)`,
    })
    .from(feeChallans)
    .where(and(...conditions))
    .groupBy(feeChallans.billingMonth, feeChallans.billingYear)
    .orderBy(desc(feeChallans.billingYear), desc(feeChallans.billingMonth));

  return rows.map((row) => {
    const billedPaise = paiseOrZero(row.billed);
    const collectedPaise = paiseOrZero(row.collected);

    return {
      billingMonth: row.billingMonth ?? 0,
      billingYear: row.billingYear ?? 0,
      billedPaise,
      collectedPaise,
      outstandingPaise: Math.max(billedPaise - collectedPaise, 0),
      collectionRate:
        billedPaise === 0
          ? 0
          : Math.round((collectedPaise / billedPaise) * 1000) / 10,
    };
  });
}

/** Outstanding challans past a threshold, oldest first. */
export async function listDefaulters(
  locationId: string,
  minDaysOverdue: number,
): Promise<OutstandingRow[]> {
  const rows = await listOutstanding(locationId, {});
  return rows.filter((row) => row.daysOverdue >= minDaysOverdue);
}

// -----------------------------------------------------------------------------
// Portal reads
// -----------------------------------------------------------------------------

export interface StudentFeeSummary {
  studentProfileId: string;
  totalBilledPaise: Paise;
  totalPaidPaise: Paise;
  outstandingPaise: Paise;
  nextDue: { challanNumber: string; dueDate: string; balancePaise: Paise } | null;
  challans: ChallanRow[];
}

/**
 * A student's fee position for one academic year.
 *
 * Used by the student and parent portals, both of which address the student by
 * a profile id the caller already proved they may see — this function does not
 * re-check that, so callers must.
 */
export async function getStudentFeeSummary(
  locationId: string,
  studentProfileId: string,
  academicYearId: string | null,
): Promise<StudentFeeSummary> {
  const result = await listChallans(locationId, {
    studentProfileId,
    academicYearId: academicYearId ?? undefined,
    limit: 100,
    page: 1,
  });

  const billable = result.challans.filter(
    (challan) => challan.status !== 'cancelled' && challan.status !== 'waived',
  );

  const totalBilledPaise = billable.reduce(
    (total, challan) => total + challan.totalPaise,
    0,
  );
  const totalPaidPaise = billable.reduce(
    (total, challan) => total + challan.paidPaise,
    0,
  );

  const outstanding = billable
    .filter((challan) =>
      (OUTSTANDING_CHALLAN_STATUSES as readonly string[]).includes(challan.status),
    )
    .sort((left, right) => left.dueDate.localeCompare(right.dueDate));

  const next = outstanding[0];

  return {
    studentProfileId,
    totalBilledPaise,
    totalPaidPaise,
    outstandingPaise: Math.max(totalBilledPaise - totalPaidPaise, 0),
    nextDue:
      next === undefined
        ? null
        : {
            challanNumber: next.challanNumber,
            dueDate: next.dueDate,
            balancePaise: next.balancePaise,
          },
    challans: result.challans,
  };
}

/** Money taken this month — the admin dashboard headline. */
export async function getMonthlyCollection(locationId: string): Promise<{
  collectedPaise: Paise;
  outstandingPaise: Paise;
}> {
  const overview = await getFeeOverview(locationId);
  return {
    collectedPaise: overview.collectedThisMonthPaise,
    outstandingPaise: overview.outstandingThisMonthPaise,
  };
}
