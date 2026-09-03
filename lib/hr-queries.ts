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
  isNull,
  lte,
  notExists,
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
import { INVITABLE_ROLES } from '@/types/school-auth';

import { sharedOrOwnedBy } from './branch-scope';
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
  /**
   * Whether this person may be offered as a class's class teacher.
   *
   * A flag on the employment record rather than a role, because the product
   * owner settled it as one option — "Class Teacher (Home Room)" or "None".
   * Which class they actually hold is `sections.class_teacher_id`, decided on
   * the class; this only says who may appear in that picker.
   */
  isClassTeacher: boolean;
  /**
   * The portal account this person signs in with, or null.
   *
   * Sprint 22. The column has existed since Sprint 7 and no screen ever set it,
   * so every staff row in the product carried null and nothing said so. It is
   * on the *list* row rather than only the detail because "who has no login"
   * is a question a school answers by scanning the directory, not by opening
   * forty profiles.
   */
  schoolUserId: string | null;
  /**
   * The personnel photograph, or null (Sprint 23, item 5).
   *
   * On the *list* row as well as the detail because the directory renders an
   * avatar per person, and fetching forty photographs one profile at a time is
   * forty requests to draw one screen. Null is the ordinary case and gets the
   * initials avatar `components/ui/Avatar.tsx` already draws.
   */
  photoUrl: string | null;
}

export interface ListStaffFilters {
  search?: string;
  status?: StaffStatus;
  branchId?: string;
  department?: string;
  /**
   * `'none'` = only the split records: still employed here, no portal login.
   *
   * Scoped to `active` on purpose, and it is the same scoping the badge uses.
   * A resigned driver has no login and never needed one; listing him under
   * "Unlinked" would bury the four people a school actually has to reconcile
   * under everyone who has ever left.
   */
  linked?: 'none';
  /**
   * BR4 — the campuses a scoped principal may be shown (Sprint 23, item 3).
   *
   * ── Why campuses and not classes ────────────────────────────────────────
   * A `staff` row carries `branch_id` and carries no grade at all. There is no
   * column that says which classes a bursar or a driver belongs to, and
   * inventing one out of `sections.class_teacher_id` would narrow the staff
   * list to home-room teachers — which is not what "the staff at my campus"
   * means to anybody.
   *
   * So the honest narrowing for this table is the campus half of the scope, and
   * it is stated here rather than left to be inferred: **a head assigned a
   * division but no campus sees every member of staff.** That is the same
   * answer they got before this sprint, and narrowing it further would need a
   * column the schema does not have.
   *
   * A **null** `branch_id` is admitted, exactly as a null grade is: a
   * single-campus school that never created a branch record has every staff row
   * null, and excluding them would show its heads an empty directory.
   */
  scopeBranchIds?: string[] | null | undefined;
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

  // BR4. Applied in addition to `branchId` above, never instead of it: a head
  // filtering to a campus outside their own gets nothing, not that campus.
  if (filters.scopeBranchIds != null) {
    const scoped =
      filters.scopeBranchIds.length === 0
        ? isNull(staff.branchId)
        : or(isNull(staff.branchId), inArray(staff.branchId, filters.scopeBranchIds));
    if (scoped !== undefined) conditions.push(scoped);
  }

  if (filters.linked === 'none') {
    conditions.push(eq(staff.status, 'active'));
    conditions.push(isNull(staff.schoolUserId));
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
      isClassTeacher: staff.isClassTeacher,
      schoolUserId: staff.schoolUserId,
      photoUrl: staff.photoUrl,
    })
    .from(staff)
    .leftJoin(branches, eq(branches.id, staff.branchId))
    .where(and(...conditions))
    .orderBy(asc(staff.firstName), asc(staff.lastName));

  return rows.map((row) => ({ ...row, fullName: staffFullName(row) }));
}

export interface StaffDetail extends StaffRow {
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
      isClassTeacher: staff.isClassTeacher,
      schoolUserId: staff.schoolUserId,
      photoUrl: staff.photoUrl,
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

export interface UnlinkedSchoolUser {
  id: string;
  name: string;
  role: string;
  phone: string;
  email: string | null;
  branchName: string | null;
}

/**
 * Portal accounts not yet attached to an employment record — the link picker.
 *
 * ── Two things changed in Sprint 22, and the second is the point ────────
 * It was written "for the link picker" in Sprint 7 and no screen ever called
 * it, so it has never returned a row to anybody. Now that one does, two of its
 * habits had to go.
 *
 * It read every `staff` row of the school to build a list of taken ids and
 * filtered the accounts in JavaScript afterwards — correct, and it fetched the
 * whole staff table to answer a question Postgres answers with an index
 * (`staff_school_user_id_idx`). `NOT EXISTS` is that question, correlated on
 * the account's own id and **carrying the tenant on both sides**: the outer
 * filter alone would let another school's `staff` row make an account here look
 * taken, which is a leak of the fact that the row exists.
 *
 * `student` and `parent` are excluded. An account created by the admissions
 * flow is not a colleague, and offering a seven-year-old in a picker headed
 * "link this employment record to an account" is an invitation to make the
 * exact mistake Sprint 21 spent itself repairing.
 */
export async function listUnlinkedSchoolUsers(
  locationId: string,
): Promise<UnlinkedSchoolUser[]> {
  return db
    .select({
      id: schoolUsers.id,
      name: schoolUsers.name,
      role: schoolUsers.role,
      phone: schoolUsers.phone,
      email: schoolUsers.email,
      branchName: branches.name,
    })
    .from(schoolUsers)
    .leftJoin(branches, eq(branches.id, schoolUsers.branchId))
    .where(
      and(
        eq(schoolUsers.locationId, locationId),
        eq(schoolUsers.isActive, true),
        inArray(schoolUsers.role, [...INVITABLE_ROLES]),
        notExists(
          db
            .select({ present: sql`1` })
            .from(staff)
            .where(
              and(
                eq(staff.locationId, locationId),
                eq(staff.schoolUserId, schoolUsers.id),
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(schoolUsers.name));
}

/**
 * The employment record one portal account backs, or null.
 *
 * The mirror of `staff.school_user_id`, read from the other end, for the
 * Users & Staff profile. `limit(1)` is not a choice between candidates: every
 * write path here refuses an account that already backs a record, so more than
 * one would be a defect, and the ordering makes which one is shown at least
 * stable while somebody is looking at it.
 */
export async function getStaffBySchoolUserId(
  locationId: string,
  schoolUserId: string,
): Promise<{
  id: string;
  employeeCode: string;
  fullName: string;
  designation: string | null;
  department: string | null;
  status: StaffStatus;
} | null> {
  const rows = await db
    .select({
      id: staff.id,
      employeeCode: staff.employeeCode,
      firstName: staff.firstName,
      lastName: staff.lastName,
      designation: staff.designation,
      department: staff.department,
      status: staff.status,
    })
    .from(staff)
    .where(
      and(
        eq(staff.locationId, locationId),
        eq(staff.schoolUserId, schoolUserId),
      ),
    )
    .orderBy(asc(staff.createdAt), asc(staff.id))
    .limit(1);

  const row = rows[0];
  return row === undefined ? null : { ...row, fullName: staffFullName(row) };
}

/**
 * The next free `EMP-<n>` for this school.
 *
 * `staff.employee_code` is `NOT NULL` and unique per school and there has never
 * been a generator, which is fine on the HR screen — a school entering its
 * payroll has its own codes to hand — and hopeless on Invite Staff, where the
 * person filling the form is inviting a colleague and has no idea what the
 * school's numbering is. So this proposes; the field stays editable.
 *
 * Read in JavaScript rather than by a `max()` over a cast, because the column
 * holds whatever a school has ever typed into it. `EMP-7`, `emp-007`, `T-14`
 * and `Ahmed` are all valid values of it today, and a `substring(...)::int` over
 * that set is a `22P02` on the row nobody expected. Anything that does not
 * match `EMP-<digits>` is simply not a candidate, and a school with no matching
 * code at all starts at `EMP-001`.
 *
 * It is a **proposal, not a reservation**: two administrators on the same
 * minute are offered the same number, and the second one meets the `23505` the
 * unique index raises, named against the field. That is the honest behaviour —
 * reserving a code would leave a gap in the numbering every time somebody
 * abandoned a form.
 */
export async function nextEmployeeCode(locationId: string): Promise<string> {
  const rows = await db
    .select({ employeeCode: staff.employeeCode })
    .from(staff)
    .where(and(eq(staff.locationId, locationId), ilike(staff.employeeCode, 'EMP-%')));

  let highest = 0;
  for (const row of rows) {
    const match = /^EMP-(\d+)$/i.exec(row.employeeCode.trim());
    if (match?.[1] === undefined) continue;

    const value = Number.parseInt(match[1], 10);
    if (Number.isFinite(value) && value > highest) highest = value;
  }

  return `EMP-${String(highest + 1).padStart(3, '0')}`;
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
  options: { activeOnly?: boolean; branchIds?: string[] | null | undefined } = {},
): Promise<SalaryComponentRow[]> {
  const conditions: SQL[] = [eq(salaryComponents.locationId, locationId)];
  if (options.activeOnly === true) conditions.push(eq(salaryComponents.isActive, true));

  const branchFilter = sharedOrOwnedBy(
    salaryComponents.branchId,
    options.branchIds ?? null,
  );
  if (branchFilter !== undefined) conditions.push(branchFilter);

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
  options: { activeOnly?: boolean; branchIds?: string[] | null | undefined } = {},
): Promise<LeaveTypeRow[]> {
  const conditions: SQL[] = [eq(leaveTypes.locationId, locationId)];
  if (options.activeOnly === true) conditions.push(eq(leaveTypes.isActive, true));

  const branchFilter = sharedOrOwnedBy(leaveTypes.branchId, options.branchIds ?? null);
  if (branchFilter !== undefined) conditions.push(branchFilter);

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
