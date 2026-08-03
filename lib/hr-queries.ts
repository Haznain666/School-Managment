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
  branches,
  leaveRequests,
  leaveTypes,
  payrollRuns,
  payslipItems,
  payslips,
  salaryComponents,
  schoolUsers,
  schools,
  staff,
  staffAttendance,
  staffSalaryStructures,
  staffFullName,
  type ComponentCalculation,
  type ComponentKind,
  type EmploymentType,
  type Gender,
  type LeaveStatus,
  type PaymentMode,
  type PayrollRunStatus,
  type PayslipStatus,
  type StaffAttendanceStatus,
  type StaffStatus,
} from '@/db/schema';

import { db } from './drizzle';
import { toPaise } from './money';
import {
  leaveDaysInMonth,
  payrollMonthRange,
  type PayrollAssignment,
  type PayrollComponent,
} from './payroll-calculator';

/**
 * Tenant-scoped reads for HR & Payroll (Sprint 7).
 *
 * Same contract as `lib/fee-queries.ts` and `lib/academics-queries.ts`: every
 * function takes `locationId` first and filters on it, and that value must have
 * come from verified session claims. Nothing here may be called with an id
 * taken out of a request body.
 */

// -----------------------------------------------------------------------------
// Staff
// -----------------------------------------------------------------------------

export interface StaffRow {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  fullName: string;
  designation: string | null;
  department: string | null;
  employmentType: EmploymentType | null;
  status: StaffStatus;
  joinedOn: string | null;
  resignedOn: string | null;
  phone: string | null;
  email: string | null;
  branchId: string | null;
  branchName: string | null;
}

export interface ListStaffFilters {
  search?: string;
  status?: StaffStatus;
  branchId?: string;
  department?: string;
}

/**
 * The staff directory.
 *
 * `branchId` is a filter here rather than a scope: the caller decides whether
 * to pass their own branch, because a school admin sees everyone and a branch
 * admin must see only their own. Passing it is the route's job, not this
 * function's.
 */
export async function listStaff(
  locationId: string,
  filters: ListStaffFilters = {},
): Promise<StaffRow[]> {
  const conditions: SQL[] = [eq(staff.locationId, locationId)];

  if (filters.status !== undefined) {
    conditions.push(eq(staff.status, filters.status));
  }

  if (filters.branchId !== undefined && filters.branchId !== '') {
    conditions.push(eq(staff.branchId, filters.branchId));
  }

  if (filters.department !== undefined && filters.department !== '') {
    conditions.push(eq(staff.department, filters.department));
  }

  const search = filters.search?.trim() ?? '';
  if (search !== '') {
    const pattern = `%${search}%`;
    const matches = or(
      ilike(staff.firstName, pattern),
      ilike(staff.lastName, pattern),
      ilike(staff.employeeCode, pattern),
      ilike(staff.designation, pattern),
    );
    if (matches !== undefined) conditions.push(matches);
  }

  const rows = await db
    .select({
      id: staff.id,
      employeeCode: staff.employeeCode,
      firstName: staff.firstName,
      lastName: staff.lastName,
      designation: staff.designation,
      department: staff.department,
      employmentType: staff.employmentType,
      status: staff.status,
      joinedOn: staff.joinedOn,
      resignedOn: staff.resignedOn,
      phone: staff.phone,
      email: staff.email,
      branchId: staff.branchId,
      branchName: branches.name,
    })
    .from(staff)
    .leftJoin(branches, eq(branches.id, staff.branchId))
    .where(and(...conditions))
    .orderBy(asc(staff.firstName), asc(staff.lastName));

  return rows.map((row) => ({ ...row, fullName: staffFullName(row) }));
}

export interface StaffDetail extends StaffRow {
  schoolUserId: string | null;
  cnic: string | null;
  dateOfBirth: string | null;
  gender: Gender | null;
  address: string | null;
  qualification: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  bankAccountTitle: string | null;
  bankAccountNumber: string | null;
  bankName: string | null;
}

export async function getStaff(
  locationId: string,
  staffId: string,
): Promise<StaffDetail | null> {
  const rows = await db
    .select({
      id: staff.id,
      employeeCode: staff.employeeCode,
      firstName: staff.firstName,
      lastName: staff.lastName,
      designation: staff.designation,
      department: staff.department,
      employmentType: staff.employmentType,
      status: staff.status,
      joinedOn: staff.joinedOn,
      resignedOn: staff.resignedOn,
      phone: staff.phone,
      email: staff.email,
      branchId: staff.branchId,
      branchName: branches.name,
      schoolUserId: staff.schoolUserId,
      cnic: staff.cnic,
      dateOfBirth: staff.dateOfBirth,
      gender: staff.gender,
      address: staff.address,
      qualification: staff.qualification,
      emergencyContactName: staff.emergencyContactName,
      emergencyContactPhone: staff.emergencyContactPhone,
      bankAccountTitle: staff.bankAccountTitle,
      bankAccountNumber: staff.bankAccountNumber,
      bankName: staff.bankName,
    })
    .from(staff)
    .leftJoin(branches, eq(branches.id, staff.branchId))
    .where(and(eq(staff.locationId, locationId), eq(staff.id, staffId)))
    .limit(1);

  const row = rows[0];
  return row === undefined ? null : { ...row, fullName: staffFullName(row) };
}

/** Portal accounts not yet attached to an employment record, for the link picker. */
export async function listUnlinkedSchoolUsers(
  locationId: string,
): Promise<Array<{ id: string; name: string; role: string; phone: string }>> {
  const linked = await db
    .select({ schoolUserId: staff.schoolUserId })
    .from(staff)
    .where(eq(staff.locationId, locationId));

  const takenIds = linked
    .map((row) => row.schoolUserId)
    .filter((value): value is string => value !== null);

  const conditions: SQL[] = [
    eq(schoolUsers.locationId, locationId),
    eq(schoolUsers.isActive, true),
  ];

  const rows = await db
    .select({
      id: schoolUsers.id,
      name: schoolUsers.name,
      role: schoolUsers.role,
      phone: schoolUsers.phone,
    })
    .from(schoolUsers)
    .where(and(...conditions))
    .orderBy(asc(schoolUsers.name));

  return rows.filter((row) => !takenIds.includes(row.id));
}

/** Distinct departments already in use, so the form can offer them. */
export async function listDepartments(locationId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ department: staff.department })
    .from(staff)
    .where(eq(staff.locationId, locationId))
    .orderBy(asc(staff.department));

  return rows
    .map((row) => row.department)
    .filter((value): value is string => value !== null && value !== '');
}

// -----------------------------------------------------------------------------
// Salary components and structures
// -----------------------------------------------------------------------------

export interface SalaryComponentRow {
  id: string;
  name: string;
  description: string | null;
  kind: ComponentKind;
  calculation: ComponentCalculation;
  defaultPercentBasisPoints: number | null;
  isBasic: boolean;
  proratedByAttendance: boolean;
  isActive: boolean;
  sortOrder: number;
}

export async function listSalaryComponents(
  locationId: string,
  options: { activeOnly?: boolean } = {},
): Promise<SalaryComponentRow[]> {
  const conditions: SQL[] = [eq(salaryComponents.locationId, locationId)];
  if (options.activeOnly === true) conditions.push(eq(salaryComponents.isActive, true));

  return db
    .select({
      id: salaryComponents.id,
      name: salaryComponents.name,
      description: salaryComponents.description,
      kind: salaryComponents.kind,
      calculation: salaryComponents.calculation,
      defaultPercentBasisPoints: salaryComponents.defaultPercentBasisPoints,
      isBasic: salaryComponents.isBasic,
      proratedByAttendance: salaryComponents.proratedByAttendance,
      isActive: salaryComponents.isActive,
      sortOrder: salaryComponents.sortOrder,
    })
    .from(salaryComponents)
    .where(and(...conditions))
    .orderBy(asc(salaryComponents.kind), asc(salaryComponents.sortOrder));
}

export async function getSalaryComponent(
  locationId: string,
  componentId: string,
): Promise<SalaryComponentRow | null> {
  const rows = await db
    .select({
      id: salaryComponents.id,
      name: salaryComponents.name,
      description: salaryComponents.description,
      kind: salaryComponents.kind,
      calculation: salaryComponents.calculation,
      defaultPercentBasisPoints: salaryComponents.defaultPercentBasisPoints,
      isBasic: salaryComponents.isBasic,
      proratedByAttendance: salaryComponents.proratedByAttendance,
      isActive: salaryComponents.isActive,
      sortOrder: salaryComponents.sortOrder,
    })
    .from(salaryComponents)
    .where(
      and(
        eq(salaryComponents.locationId, locationId),
        eq(salaryComponents.id, componentId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export interface SalaryStructureRow {
  componentId: string;
  componentName: string;
  kind: ComponentKind;
  calculation: ComponentCalculation;
  isBasic: boolean;
  /** Rupees, as a NUMERIC string. */
  amount: string;
  percentBasisPoints: number | null;
  defaultPercentBasisPoints: number | null;
  sortOrder: number;
}

export async function getStaffSalaryStructure(
  locationId: string,
  staffId: string,
): Promise<SalaryStructureRow[]> {
  return db
    .select({
      componentId: staffSalaryStructures.componentId,
      componentName: salaryComponents.name,
      kind: salaryComponents.kind,
      calculation: salaryComponents.calculation,
      isBasic: salaryComponents.isBasic,
      amount: staffSalaryStructures.amount,
      percentBasisPoints: staffSalaryStructures.percentBasisPoints,
      defaultPercentBasisPoints: salaryComponents.defaultPercentBasisPoints,
      sortOrder: salaryComponents.sortOrder,
    })
    .from(staffSalaryStructures)
    .innerJoin(
      salaryComponents,
      eq(salaryComponents.id, staffSalaryStructures.componentId),
    )
    .where(
      and(
        eq(staffSalaryStructures.locationId, locationId),
        eq(staffSalaryStructures.staffId, staffId),
      ),
    )
    .orderBy(asc(salaryComponents.kind), asc(salaryComponents.sortOrder));
}

/** The component catalogue in the shape `lib/payroll-calculator.ts` expects. */
export function toPayrollComponents(
  rows: readonly SalaryComponentRow[],
): PayrollComponent[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    calculation: row.calculation,
    isBasic: row.isBasic,
    proratedByAttendance: row.proratedByAttendance,
    sortOrder: row.sortOrder,
  }));
}

/** Every staff member's assignments in one query, keyed by staff id. */
export async function getSalaryAssignmentsByStaff(
  locationId: string,
  staffIds: readonly string[],
): Promise<Map<string, PayrollAssignment[]>> {
  const byStaff = new Map<string, PayrollAssignment[]>();
  if (staffIds.length === 0) return byStaff;

  const rows = await db
    .select({
      staffId: staffSalaryStructures.staffId,
      componentId: staffSalaryStructures.componentId,
      amount: staffSalaryStructures.amount,
      percentBasisPoints: staffSalaryStructures.percentBasisPoints,
      defaultPercentBasisPoints: salaryComponents.defaultPercentBasisPoints,
    })
    .from(staffSalaryStructures)
    .innerJoin(
      salaryComponents,
      eq(salaryComponents.id, staffSalaryStructures.componentId),
    )
    .where(
      and(
        eq(staffSalaryStructures.locationId, locationId),
        inArray(staffSalaryStructures.staffId, [...staffIds]),
      ),
    );

  for (const row of rows) {
    const existing = byStaff.get(row.staffId) ?? [];
    existing.push({
      componentId: row.componentId,
      amount: row.amount,
      percentBasisPoints: row.percentBasisPoints,
      defaultPercentBasisPoints: row.defaultPercentBasisPoints,
    });
    byStaff.set(row.staffId, existing);
  }

  return byStaff;
}

/** Monthly cost of one staff member's structure, in paise. For the HR summary. */
export function structureGrossPaise(rows: readonly SalaryStructureRow[]): number {
  const basic = rows.find((row) => row.isBasic);
  const basicPaise = basic === undefined ? 0 : toPaise(basic.amount);

  return rows
    .filter((row) => row.kind === 'earning')
    .reduce((sum, row) => {
      if (row.calculation === 'percent_of_basic') {
        const points = row.percentBasisPoints ?? row.defaultPercentBasisPoints ?? 0;
        return sum + Math.round((basicPaise * points) / 10_000);
      }
      return sum + toPaise(row.amount);
    }, 0);
}

// -----------------------------------------------------------------------------
// Leave
// -----------------------------------------------------------------------------

export interface LeaveTypeRow {
  id: string;
  name: string;
  description: string | null;
  annualQuotaDays: number;
  isPaid: boolean;
  isActive: boolean;
  sortOrder: number;
}

export async function listLeaveTypes(
  locationId: string,
  options: { activeOnly?: boolean } = {},
): Promise<LeaveTypeRow[]> {
  const conditions: SQL[] = [eq(leaveTypes.locationId, locationId)];
  if (options.activeOnly === true) conditions.push(eq(leaveTypes.isActive, true));

  return db
    .select({
      id: leaveTypes.id,
      name: leaveTypes.name,
      description: leaveTypes.description,
      annualQuotaDays: leaveTypes.annualQuotaDays,
      isPaid: leaveTypes.isPaid,
      isActive: leaveTypes.isActive,
      sortOrder: leaveTypes.sortOrder,
    })
    .from(leaveTypes)
    .where(and(...conditions))
    .orderBy(asc(leaveTypes.sortOrder), asc(leaveTypes.name));
}

export async function getLeaveType(
  locationId: string,
  leaveTypeId: string,
): Promise<LeaveTypeRow | null> {
  const rows = await listLeaveTypes(locationId);
  return rows.find((row) => row.id === leaveTypeId) ?? null;
}

export interface LeaveRequestRow {
  id: string;
  staffId: string;
  staffName: string;
  employeeCode: string;
  leaveTypeId: string;
  leaveTypeName: string;
  isPaid: boolean;
  startDate: string;
  endDate: string;
  totalDays: string;
  reason: string | null;
  status: LeaveStatus;
  decisionNote: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}

export interface ListLeaveFilters {
  status?: LeaveStatus;
  staffId?: string;
  branchId?: string;
}

export async function listLeaveRequests(
  locationId: string,
  filters: ListLeaveFilters = {},
): Promise<LeaveRequestRow[]> {
  const conditions: SQL[] = [eq(leaveRequests.locationId, locationId)];

  if (filters.status !== undefined) conditions.push(eq(leaveRequests.status, filters.status));
  if (filters.staffId !== undefined) conditions.push(eq(leaveRequests.staffId, filters.staffId));
  if (filters.branchId !== undefined && filters.branchId !== '') {
    conditions.push(eq(staff.branchId, filters.branchId));
  }

  const rows = await db
    .select({
      id: leaveRequests.id,
      staffId: leaveRequests.staffId,
      firstName: staff.firstName,
      lastName: staff.lastName,
      employeeCode: staff.employeeCode,
      leaveTypeId: leaveRequests.leaveTypeId,
      leaveTypeName: leaveTypes.name,
      isPaid: leaveTypes.isPaid,
      startDate: leaveRequests.startDate,
      endDate: leaveRequests.endDate,
      totalDays: leaveRequests.totalDays,
      reason: leaveRequests.reason,
      status: leaveRequests.status,
      decisionNote: leaveRequests.decisionNote,
      decidedAt: leaveRequests.decidedAt,
      createdAt: leaveRequests.createdAt,
    })
    .from(leaveRequests)
    .innerJoin(staff, eq(staff.id, leaveRequests.staffId))
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
    .where(and(...conditions))
    .orderBy(desc(leaveRequests.createdAt));

  return rows.map(({ firstName, lastName, ...rest }) => ({
    ...rest,
    staffName: staffFullName({ firstName, lastName }),
  }));
}

export async function getLeaveRequest(
  locationId: string,
  requestId: string,
): Promise<LeaveRequestRow | null> {
  const rows = await db
    .select({
      id: leaveRequests.id,
      staffId: leaveRequests.staffId,
      firstName: staff.firstName,
      lastName: staff.lastName,
      employeeCode: staff.employeeCode,
      leaveTypeId: leaveRequests.leaveTypeId,
      leaveTypeName: leaveTypes.name,
      isPaid: leaveTypes.isPaid,
      startDate: leaveRequests.startDate,
      endDate: leaveRequests.endDate,
      totalDays: leaveRequests.totalDays,
      reason: leaveRequests.reason,
      status: leaveRequests.status,
      decisionNote: leaveRequests.decisionNote,
      decidedAt: leaveRequests.decidedAt,
      createdAt: leaveRequests.createdAt,
    })
    .from(leaveRequests)
    .innerJoin(staff, eq(staff.id, leaveRequests.staffId))
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
    .where(and(eq(leaveRequests.locationId, locationId), eq(leaveRequests.id, requestId)))
    .limit(1);

  const row = rows[0];
  if (row === undefined) return null;

  const { firstName, lastName, ...rest } = row;
  return { ...rest, staffName: staffFullName({ firstName, lastName }) };
}

/**
 * Approved unpaid-leave days per staff member for a payroll month.
 *
 * A request spanning the month boundary is apportioned rather than counted
 * whole — see `leaveDaysInMonth`. Only unpaid types are returned, because paid
 * leave is exactly the leave that does not dock anyone.
 */
export async function unpaidLeaveDaysByStaff(
  locationId: string,
  month: number,
  year: number,
): Promise<Map<string, number>> {
  const { start, end } = payrollMonthRange(month, year);

  const rows = await db
    .select({
      staffId: leaveRequests.staffId,
      startDate: leaveRequests.startDate,
      endDate: leaveRequests.endDate,
      totalDays: leaveRequests.totalDays,
    })
    .from(leaveRequests)
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
    .where(
      and(
        eq(leaveRequests.locationId, locationId),
        eq(leaveRequests.status, 'approved'),
        eq(leaveTypes.isPaid, false),
        // Any overlap with the month, in either direction.
        lte(leaveRequests.startDate, end),
        gte(leaveRequests.endDate, start),
      ),
    );

  const byStaff = new Map<string, number>();
  for (const row of rows) {
    const days = leaveDaysInMonth(
      {
        startDate: row.startDate,
        endDate: row.endDate,
        totalDays: Number.parseFloat(row.totalDays),
      },
      month,
      year,
    );
    byStaff.set(row.staffId, (byStaff.get(row.staffId) ?? 0) + days);
  }

  return byStaff;
}

// -----------------------------------------------------------------------------
// Staff attendance
// -----------------------------------------------------------------------------

export interface StaffAttendanceRow {
  staffId: string;
  status: StaffAttendanceStatus;
  notes: string | null;
}

export async function getStaffAttendanceForDate(
  locationId: string,
  date: string,
  branchId: string | null,
): Promise<StaffAttendanceRow[]> {
  const conditions: SQL[] = [
    eq(staffAttendance.locationId, locationId),
    eq(staffAttendance.date, date),
  ];

  if (branchId !== null) conditions.push(eq(staff.branchId, branchId));

  return db
    .select({
      staffId: staffAttendance.staffId,
      status: staffAttendance.status,
      notes: staffAttendance.notes,
    })
    .from(staffAttendance)
    .innerJoin(staff, eq(staff.id, staffAttendance.staffId))
    .where(and(...conditions));
}

export interface AttendanceTally {
  absentDays: number;
  halfDays: number;
  presentDays: number;
}

/** Absences and half days per staff member across a payroll month. */
export async function attendanceTallyByStaff(
  locationId: string,
  month: number,
  year: number,
): Promise<Map<string, AttendanceTally>> {
  const { start, end } = payrollMonthRange(month, year);

  const rows = await db
    .select({
      staffId: staffAttendance.staffId,
      status: staffAttendance.status,
      total: count(),
    })
    .from(staffAttendance)
    .where(
      and(
        eq(staffAttendance.locationId, locationId),
        gte(staffAttendance.date, start),
        lte(staffAttendance.date, end),
      ),
    )
    .groupBy(staffAttendance.staffId, staffAttendance.status);

  const byStaff = new Map<string, AttendanceTally>();

  for (const row of rows) {
    const tally = byStaff.get(row.staffId) ?? {
      absentDays: 0,
      halfDays: 0,
      presentDays: 0,
    };

    // `leave` is deliberately not counted here: whether it docks anyone is the
    // leave request's business, and counting it in both places would dock twice.
    if (row.status === 'absent') tally.absentDays += row.total;
    else if (row.status === 'half_day') tally.halfDays += row.total;
    else if (row.status === 'present' || row.status === 'late') {
      tally.presentDays += row.total;
    }

    byStaff.set(row.staffId, tally);
  }

  return byStaff;
}

// -----------------------------------------------------------------------------
// Payroll runs and payslips
// -----------------------------------------------------------------------------

export interface PayrollRunRow {
  id: string;
  branchId: string | null;
  branchName: string | null;
  payrollMonth: number;
  payrollYear: number;
  status: PayrollRunStatus;
  workingDays: number;
  staffCount: number;
  grossTotal: string;
  deductionTotal: string;
  netTotal: string;
  notes: string | null;
  createdAt: Date;
}

export async function listPayrollRuns(
  locationId: string,
  filters: { status?: PayrollRunStatus; year?: number } = {},
): Promise<PayrollRunRow[]> {
  const conditions: SQL[] = [eq(payrollRuns.locationId, locationId)];
  if (filters.status !== undefined) conditions.push(eq(payrollRuns.status, filters.status));
  if (filters.year !== undefined) conditions.push(eq(payrollRuns.payrollYear, filters.year));

  return db
    .select({
      id: payrollRuns.id,
      branchId: payrollRuns.branchId,
      branchName: branches.name,
      payrollMonth: payrollRuns.payrollMonth,
      payrollYear: payrollRuns.payrollYear,
      status: payrollRuns.status,
      workingDays: payrollRuns.workingDays,
      staffCount: payrollRuns.staffCount,
      grossTotal: payrollRuns.grossTotal,
      deductionTotal: payrollRuns.deductionTotal,
      netTotal: payrollRuns.netTotal,
      notes: payrollRuns.notes,
      createdAt: payrollRuns.createdAt,
    })
    .from(payrollRuns)
    .leftJoin(branches, eq(branches.id, payrollRuns.branchId))
    .where(and(...conditions))
    .orderBy(desc(payrollRuns.payrollYear), desc(payrollRuns.payrollMonth));
}

export async function getPayrollRun(
  locationId: string,
  runId: string,
): Promise<PayrollRunRow | null> {
  const rows = await db
    .select({
      id: payrollRuns.id,
      branchId: payrollRuns.branchId,
      branchName: branches.name,
      payrollMonth: payrollRuns.payrollMonth,
      payrollYear: payrollRuns.payrollYear,
      status: payrollRuns.status,
      workingDays: payrollRuns.workingDays,
      staffCount: payrollRuns.staffCount,
      grossTotal: payrollRuns.grossTotal,
      deductionTotal: payrollRuns.deductionTotal,
      netTotal: payrollRuns.netTotal,
      notes: payrollRuns.notes,
      createdAt: payrollRuns.createdAt,
    })
    .from(payrollRuns)
    .leftJoin(branches, eq(branches.id, payrollRuns.branchId))
    .where(and(eq(payrollRuns.locationId, locationId), eq(payrollRuns.id, runId)))
    .limit(1);

  return rows[0] ?? null;
}

export interface PayslipRow {
  id: string;
  payslipNumber: string;
  staffId: string;
  staffName: string;
  employeeCode: string;
  designation: string | null;
  grossEarnings: string;
  totalDeductions: string;
  lossOfPayDays: string;
  lossOfPayAmount: string;
  netPayable: string;
  status: PayslipStatus;
  paymentMode: PaymentMode | null;
  paidOn: string | null;
}

export async function listPayslipsForRun(
  locationId: string,
  runId: string,
): Promise<PayslipRow[]> {
  return db
    .select({
      id: payslips.id,
      payslipNumber: payslips.payslipNumber,
      staffId: payslips.staffId,
      staffName: payslips.staffName,
      employeeCode: payslips.employeeCode,
      designation: payslips.designation,
      grossEarnings: payslips.grossEarnings,
      totalDeductions: payslips.totalDeductions,
      lossOfPayDays: payslips.lossOfPayDays,
      lossOfPayAmount: payslips.lossOfPayAmount,
      netPayable: payslips.netPayable,
      status: payslips.status,
      paymentMode: payslips.paymentMode,
      paidOn: payslips.paidOn,
    })
    .from(payslips)
    .where(and(eq(payslips.locationId, locationId), eq(payslips.payrollRunId, runId)))
    .orderBy(asc(payslips.payslipNumber));
}

export interface PayslipDetail extends PayslipRow {
  payrollRunId: string;
  payrollMonth: number;
  payrollYear: number;
  workingDays: number;
  runStatus: PayrollRunStatus;
  bankAccountTitle: string | null;
  bankAccountNumber: string | null;
  bankName: string | null;
  paymentReference: string | null;
  notes: string | null;
  schoolName: string;
  schoolCity: string;
  branchName: string | null;
  items: Array<{
    id: string;
    description: string;
    kind: string;
    amount: string;
    sortOrder: number;
  }>;
}

export async function getPayslipDetail(
  locationId: string,
  payslipId: string,
): Promise<PayslipDetail | null> {
  const rows = await db
    .select({
      id: payslips.id,
      payslipNumber: payslips.payslipNumber,
      staffId: payslips.staffId,
      staffName: payslips.staffName,
      employeeCode: payslips.employeeCode,
      designation: payslips.designation,
      grossEarnings: payslips.grossEarnings,
      totalDeductions: payslips.totalDeductions,
      lossOfPayDays: payslips.lossOfPayDays,
      lossOfPayAmount: payslips.lossOfPayAmount,
      netPayable: payslips.netPayable,
      status: payslips.status,
      paymentMode: payslips.paymentMode,
      paidOn: payslips.paidOn,
      paymentReference: payslips.paymentReference,
      notes: payslips.notes,
      bankAccountTitle: payslips.bankAccountTitle,
      bankAccountNumber: payslips.bankAccountNumber,
      bankName: payslips.bankName,
      payrollRunId: payslips.payrollRunId,
      payrollMonth: payrollRuns.payrollMonth,
      payrollYear: payrollRuns.payrollYear,
      workingDays: payrollRuns.workingDays,
      runStatus: payrollRuns.status,
      schoolName: schools.name,
      schoolCity: schools.city,
      branchName: branches.name,
    })
    .from(payslips)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.payrollRunId))
    .innerJoin(schools, eq(schools.locationId, payslips.locationId))
    .leftJoin(branches, eq(branches.id, payslips.branchId))
    .where(and(eq(payslips.locationId, locationId), eq(payslips.id, payslipId)))
    .limit(1);

  const row = rows[0];
  if (row === undefined) return null;

  const items = await db
    .select({
      id: payslipItems.id,
      description: payslipItems.description,
      kind: payslipItems.kind,
      amount: payslipItems.amount,
      sortOrder: payslipItems.sortOrder,
    })
    .from(payslipItems)
    .where(
      and(eq(payslipItems.locationId, locationId), eq(payslipItems.payslipId, payslipId)),
    )
    .orderBy(asc(payslipItems.kind), asc(payslipItems.sortOrder));

  return { ...row, items };
}

/** The school code and name a run needs to issue numbers and print slips. */
export async function getSchoolPayrollHeader(
  locationId: string,
): Promise<{ name: string; schoolCode: string | null } | null> {
  const rows = await db
    .select({ name: schools.name, schoolCode: schools.schoolCode })
    .from(schools)
    .where(eq(schools.locationId, locationId))
    .limit(1);

  return rows[0] ?? null;
}

// -----------------------------------------------------------------------------
// Dashboard
// -----------------------------------------------------------------------------

export interface HrSummary {
  totalStaff: number;
  activeStaff: number;
  onLeaveStaff: number;
  pendingLeaveRequests: number;
  componentsConfigured: number;
  staffWithoutSalary: number;
}

export async function getHrSummary(locationId: string): Promise<HrSummary> {
  const [statusRows, pendingRows, componentRows, structuredRows] = await Promise.all([
    db
      .select({ status: staff.status, total: count() })
      .from(staff)
      .where(eq(staff.locationId, locationId))
      .groupBy(staff.status),
    db
      .select({ total: count() })
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.locationId, locationId),
          eq(leaveRequests.status, 'pending'),
        ),
      ),
    db
      .select({ total: count() })
      .from(salaryComponents)
      .where(
        and(
          eq(salaryComponents.locationId, locationId),
          eq(salaryComponents.isActive, true),
        ),
      ),
    db
      .select({ total: sql<number>`count(distinct ${staffSalaryStructures.staffId})` })
      .from(staffSalaryStructures)
      .where(eq(staffSalaryStructures.locationId, locationId)),
  ]);

  const totalStaff = statusRows.reduce((sum, row) => sum + row.total, 0);
  const activeStaff =
    statusRows.find((row) => row.status === 'active')?.total ?? 0;
  const onLeaveStaff =
    statusRows.find((row) => row.status === 'on_leave')?.total ?? 0;
  const withSalary = Number(structuredRows[0]?.total ?? 0);

  return {
    totalStaff,
    activeStaff,
    onLeaveStaff,
    pendingLeaveRequests: pendingRows[0]?.total ?? 0,
    componentsConfigured: componentRows[0]?.total ?? 0,
    // Only active staff need a structure; a resigned member does not.
    staffWithoutSalary: Math.max(0, activeStaff - withSalary),
  };
}
