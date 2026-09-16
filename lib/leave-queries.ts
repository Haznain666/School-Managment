import 'server-only';

import { and, asc, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';

import {
  branchLeaveSettings,
  branches,
  DEFAULT_HOLIDAY_SPAN,
  leaveRequests,
  leaveTypes,
  schoolUsers,
  staff,
  staffFullName,
  type HolidaySpan,
  type LeaveStatus,
} from '@/db/schema';
import type { UserRole } from '@/types/school-auth';

import { getActiveAcademicYear } from './admissions-queries';
import {
  decisionRefusal,
  loadChainIndex,
  resolveChain,
  type ChainApplicant,
  type ChainDecider,
  type ChainIndex,
} from './approval-chain';
import { db } from './drizzle';
import {
  academicYearRange,
  computeQuota,
  type AcademicYearLike,
  type LeaveQuota,
} from './leave-quota';

/**
 * `lib/leave-queries.ts` — the reads leave management is built on. Sprint 33b.
 *
 * ── Why this is not `lib/hr-queries.ts` ──────────────────────────────────
 * That module answers HR's questions and every function in it takes a staff id
 * chosen by somebody entitled to choose any of them. Leave is now decided by
 * people who are **not** HR — a coordinator, a section head, a deputy — and
 * what they may see is decided by `lib/approval-chain.ts` rather than by a
 * permission. Keeping the two apart is what stops a coordinator's list being
 * one forgotten filter away from the whole school's.
 *
 * `listLeaveRequests` and `getLeaveRequest` in `lib/hr-queries.ts` stay exactly
 * as Part A left them: they are HR's screen, gated on `hr.read`, and they are
 * what the campus guard `0046` shipped protects. Nothing here changes them.
 *
 * ── The chain is loaded once ─────────────────────────────────────────────
 * `loadChainIndex` is three indexed reads for a whole school, and the listing
 * then resolves fifty requests in memory. The alternative — a chain query per
 * request — is fifty round trips to draw one table.
 */

/* --------------------------------------------------------------- applicants */

export interface LeaveApplicant extends ChainApplicant {
  employeeCode: string;
  designation: string | null;
  branchName: string | null;
  permanentFrom: string | null;
}

const APPLICANT_COLUMNS = {
  staffId: staff.id,
  schoolUserId: staff.schoolUserId,
  firstName: staff.firstName,
  lastName: staff.lastName,
  employeeCode: staff.employeeCode,
  designation: staff.designation,
  branchId: staff.branchId,
  branchName: branches.name,
  permanentFrom: staff.permanentFrom,
  role: schoolUsers.role,
} as const;

function toApplicant(row: {
  staffId: string;
  schoolUserId: string | null;
  firstName: string;
  lastName: string;
  employeeCode: string;
  designation: string | null;
  branchId: string | null;
  branchName: string | null;
  permanentFrom: string | null;
  role: string | null;
}): LeaveApplicant {
  return {
    staffId: row.staffId,
    schoolUserId: row.schoolUserId,
    // Null is the junior teacher of decision 6 — a staff row with no login.
    // The chain reads it as "no coordinator link to find" and routes upward.
    role: row.role === null ? null : (row.role as UserRole),
    branchId: row.branchId,
    name: staffFullName(row),
    employeeCode: row.employeeCode,
    designation: row.designation,
    branchName: row.branchName,
    permanentFrom: row.permanentFrom,
  };
}

/**
 * One applicant, with the portal role the chain needs.
 *
 * `leftJoin` on `school_users`, never inner: a junior teacher has no account
 * and an inner join would drop exactly the people HR files leave for.
 */
export async function getLeaveApplicant(
  locationId: string,
  staffId: string,
): Promise<LeaveApplicant | null> {
  const rows = await db
    .select(APPLICANT_COLUMNS)
    .from(staff)
    .leftJoin(schoolUsers, eq(schoolUsers.id, staff.schoolUserId))
    .leftJoin(branches, eq(branches.id, staff.branchId))
    .where(and(eq(staff.locationId, locationId), eq(staff.id, staffId)))
    .limit(1);

  const row = rows[0];
  return row === undefined ? null : toApplicant(row);
}

/** Several applicants in one read, for the approvals list. */
export async function listLeaveApplicants(
  locationId: string,
  staffIds: readonly string[],
): Promise<Map<string, LeaveApplicant>> {
  if (staffIds.length === 0) return new Map();

  const rows = await db
    .select(APPLICANT_COLUMNS)
    .from(staff)
    .leftJoin(schoolUsers, eq(schoolUsers.id, staff.schoolUserId))
    .leftJoin(branches, eq(branches.id, staff.branchId))
    .where(and(eq(staff.locationId, locationId), inArray(staff.id, [...staffIds])));

  return new Map(rows.map((row) => [row.staffId, toApplicant(row)]));
}

/** Everybody HR may file leave for: the whole active payroll, campus-scoped. */
export async function listFileableStaff(
  locationId: string,
  branchIds: string[] | null,
): Promise<LeaveApplicant[]> {
  const conditions: SQL[] = [eq(staff.locationId, locationId), eq(staff.status, 'active')];
  if (branchIds !== null && branchIds.length > 0) {
    conditions.push(inArray(staff.branchId, branchIds));
  }

  const rows = await db
    .select(APPLICANT_COLUMNS)
    .from(staff)
    .leftJoin(schoolUsers, eq(schoolUsers.id, staff.schoolUserId))
    .leftJoin(branches, eq(branches.id, staff.branchId))
    .where(and(...conditions))
    .orderBy(asc(staff.firstName), asc(staff.lastName));

  return rows.map(toApplicant);
}

/* ------------------------------------------------------------------ listing */

export interface LeaveRow {
  id: string;
  staffId: string;
  staffName: string;
  employeeCode: string;
  branchId: string | null;
  branchName: string | null;
  leaveTypeId: string;
  leaveTypeName: string;
  isPaid: boolean;
  startDate: string;
  endDate: string;
  totalDays: string;
  reason: string | null;
  status: LeaveStatus;
  decisionNote: string | null;
  decidedByName: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}

/**
 * Every leave request at a school, newest first, optionally one state.
 *
 * ── `decided_by` is joined through an alias nothing else has ─────────────
 * `school_users` is **already joined** in the chain's own reads and would be
 * here too if the applicant's role were needed — so the decider's name comes
 * through `decider`, an alias no other table in this statement carries, and
 * every reference to it is qualified. CLAUDE.md's rule, and the reason is the
 * 42702 that took the all-students screen down twice: Drizzle renders an
 * aliased column unqualified and nothing will qualify it for you.
 */
const decider = schoolUsers;

export async function listLeaveForSchool(
  locationId: string,
  filters: { status?: LeaveStatus; branchIds?: string[] | null; from?: string; to?: string } = {},
): Promise<LeaveRow[]> {
  const conditions: SQL[] = [eq(leaveRequests.locationId, locationId)];

  if (filters.status !== undefined) conditions.push(eq(leaveRequests.status, filters.status));
  if (filters.branchIds != null && filters.branchIds.length > 0) {
    conditions.push(inArray(staff.branchId, filters.branchIds));
  }
  // `lte` / `gte` against date columns, never a raw template: the operator maps
  // the value for the driver and a template hands it over as it is.
  if (filters.from !== undefined) conditions.push(gte(leaveRequests.endDate, filters.from));
  if (filters.to !== undefined) conditions.push(lte(leaveRequests.startDate, filters.to));

  const rows = await db
    .select({
      id: leaveRequests.id,
      staffId: leaveRequests.staffId,
      firstName: staff.firstName,
      lastName: staff.lastName,
      employeeCode: staff.employeeCode,
      branchId: staff.branchId,
      branchName: branches.name,
      leaveTypeId: leaveRequests.leaveTypeId,
      leaveTypeName: leaveTypes.name,
      isPaid: leaveTypes.isPaid,
      startDate: leaveRequests.startDate,
      endDate: leaveRequests.endDate,
      totalDays: leaveRequests.totalDays,
      reason: leaveRequests.reason,
      status: leaveRequests.status,
      decisionNote: leaveRequests.decisionNote,
      decidedByName: decider.name,
      decidedAt: leaveRequests.decidedAt,
      createdAt: leaveRequests.createdAt,
    })
    .from(leaveRequests)
    .innerJoin(staff, eq(staff.id, leaveRequests.staffId))
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
    .leftJoin(branches, eq(branches.id, staff.branchId))
    .leftJoin(decider, eq(decider.id, leaveRequests.decidedBy))
    .where(and(...conditions))
    .orderBy(desc(leaveRequests.createdAt));

  return rows.map(({ firstName, lastName, ...rest }) => ({
    ...rest,
    staffName: staffFullName({ firstName, lastName }),
  }));
}

export interface ApprovalInbox {
  rows: Array<LeaveRow & { canDecide: boolean; chain: string[] }>;
  /** True when the caller is somebody's approver at all. */
  isApprover: boolean;
}

/**
 * The approvals list, narrowed to the people who actually report to the caller.
 *
 * ── A visibility boundary, and it is only that ───────────────────────────
 * `canDecide` is computed here so the screen can grey a button, and the
 * decision endpoint resolves the chain **again** before it writes. Neither is
 * redundant: this one decides what is drawn and that one decides what is
 * allowed, and a stale tab is the case where the two legitimately differ.
 */
export async function listApprovalInbox(
  locationId: string,
  callerDecider: ChainDecider,
  filters: { status?: LeaveStatus; branchIds?: string[] | null } = {},
): Promise<ApprovalInbox> {
  const rows = await listLeaveForSchool(locationId, filters);
  if (rows.length === 0) return { rows: [], isApprover: false };

  const [index, applicants] = await Promise.all([
    loadChainIndex(locationId),
    listLeaveApplicants(
      locationId,
      rows.map((row) => row.staffId),
    ),
  ]);

  const decorated = rows.map((row) => {
    const applicant = applicants.get(row.staffId);
    if (applicant === undefined) return { ...row, canDecide: false, chain: [] };

    const chain = resolveChain(index, applicant);
    return {
      ...row,
      canDecide: decisionRefusal(chain, callerDecider) === null,
      chain: chain.levels.map((level) => level.role),
    };
  });

  const mine = decorated.filter((row) => row.canDecide);

  return {
    // Somebody's approver sees their own queue; somebody who is nobody's
    // approver sees an empty one rather than the school's, which is the
    // boundary this function exists to draw.
    rows: mine,
    isApprover: mine.length > 0,
  };
}

/** One request with everything a decision needs, or null. */
export async function getLeaveForDecision(
  locationId: string,
  requestId: string,
): Promise<{
  request: LeaveRow;
  applicant: LeaveApplicant;
  index: ChainIndex;
} | null> {
  const rows = await listLeaveForSchool(locationId);
  const request = rows.find((row) => row.id === requestId);
  if (request === undefined) return null;

  const [applicant, index] = await Promise.all([
    getLeaveApplicant(locationId, request.staffId),
    loadChainIndex(locationId),
  ]);

  return applicant === null ? null : { request, applicant, index };
}

/* -------------------------------------------------------------- the setting */

/**
 * Whether a holiday inside a leave range counts, for one campus.
 *
 * The campus's own row beats the school's, and no row at all means `include` —
 * which is what the product did before this table existed, and what decision 11
 * says: *a range touching a holiday is accepted, and the holiday counts*.
 */
export async function holidaySpanFor(
  locationId: string,
  branchId: string | null,
): Promise<HolidaySpan> {
  const rows = await db
    .select({ branchId: branchLeaveSettings.branchId, holidaySpan: branchLeaveSettings.holidaySpan })
    .from(branchLeaveSettings)
    .where(eq(branchLeaveSettings.locationId, locationId));

  const own = branchId === null ? undefined : rows.find((row) => row.branchId === branchId);
  const schoolWide = rows.find((row) => row.branchId === null);

  return own?.holidaySpan ?? schoolWide?.holidaySpan ?? DEFAULT_HOLIDAY_SPAN;
}

export interface HolidaySpanRow {
  branchId: string | null;
  branchName: string | null;
  holidaySpan: HolidaySpan;
  /** False when this campus is inheriting the school's answer. */
  isOwn: boolean;
}

/** Every campus and what it has chosen, for the HR screen. */
export async function listHolidaySpans(locationId: string): Promise<HolidaySpanRow[]> {
  const [settings, campuses] = await Promise.all([
    db
      .select({
        branchId: branchLeaveSettings.branchId,
        holidaySpan: branchLeaveSettings.holidaySpan,
      })
      .from(branchLeaveSettings)
      .where(eq(branchLeaveSettings.locationId, locationId)),
    db
      .select({ id: branches.id, name: branches.name })
      .from(branches)
      .where(and(eq(branches.locationId, locationId), eq(branches.isActive, true)))
      .orderBy(asc(branches.name)),
  ]);

  const schoolWide = settings.find((row) => row.branchId === null)?.holidaySpan ?? DEFAULT_HOLIDAY_SPAN;

  return [
    { branchId: null, branchName: null, holidaySpan: schoolWide, isOwn: true },
    ...campuses.map((campus) => {
      const own = settings.find((row) => row.branchId === campus.id);
      return {
        branchId: campus.id,
        branchName: campus.name,
        holidaySpan: own?.holidaySpan ?? schoolWide,
        isOwn: own !== undefined,
      };
    }),
  ];
}

/** Sets one campus's answer, or the school's when `branchId` is null. */
export async function setHolidaySpan(
  locationId: string,
  branchId: string | null,
  holidaySpan: HolidaySpan,
  updatedBy: string | null,
): Promise<void> {
  const existing = await db
    .select({ id: branchLeaveSettings.id, branchId: branchLeaveSettings.branchId })
    .from(branchLeaveSettings)
    .where(eq(branchLeaveSettings.locationId, locationId));

  const row = existing.find((candidate) => candidate.branchId === branchId);

  if (row === undefined) {
    await db
      .insert(branchLeaveSettings)
      .values({ locationId, branchId, holidaySpan, updatedBy })
      .onConflictDoNothing();
    return;
  }

  await db
    .update(branchLeaveSettings)
    .set({ holidaySpan, updatedBy, updatedAt: new Date() })
    .where(
      and(eq(branchLeaveSettings.locationId, locationId), eq(branchLeaveSettings.id, row.id)),
    );
}

/* ---------------------------------------------------------------- the quota */

export interface LeaveTypeQuota extends LeaveQuota {
  leaveTypeId: string;
  leaveTypeName: string;
  isPaid: boolean;
  annualQuotaDays: number;
}

/**
 * Every leave head and what this person has left of it, this academic year.
 *
 * ── The year is the school's own, and it lapses ──────────────────────────
 * `taken` and `pending` are summed over requests **overlapping** the year
 * rather than created in it, because a request filed in July for August
 * belongs to the year it is taken in. Nothing carries forward: the sum resets
 * with the year, which is decision 10 and is why no column holds a balance.
 */
export async function quotasFor(
  locationId: string,
  applicant: { staffId: string; permanentFrom: string | null; branchId: string | null },
): Promise<{ year: AcademicYearLike | null; quotas: LeaveTypeQuota[] }> {
  const [year, heads] = await Promise.all([
    getActiveAcademicYear(locationId),
    db
      .select({
        id: leaveTypes.id,
        name: leaveTypes.name,
        isPaid: leaveTypes.isPaid,
        annualQuotaDays: leaveTypes.annualQuotaDays,
        branchId: leaveTypes.branchId,
      })
      .from(leaveTypes)
      .where(and(eq(leaveTypes.locationId, locationId), eq(leaveTypes.isActive, true)))
      .orderBy(asc(leaveTypes.sortOrder), asc(leaveTypes.name)),
  ]);

  // A head owned by another campus is not this person's. Null means shared,
  // which is every head in production today — `eq` here would empty the list.
  const mine = heads.filter(
    (head) =>
      head.branchId === null ||
      applicant.branchId === null ||
      head.branchId === applicant.branchId,
  );

  if (year === null) {
    return {
      year: null,
      quotas: mine.map((head) => ({
        leaveTypeId: head.id,
        leaveTypeName: head.name,
        isPaid: head.isPaid,
        annualQuotaDays: head.annualQuotaDays,
        entitled: 0,
        taken: 0,
        pending: 0,
        remaining: 0,
        uncapped: head.annualQuotaDays <= 0,
      })),
    };
  }

  const { start, end } = academicYearRange(year);

  const spent = await db
    .select({
      leaveTypeId: leaveRequests.leaveTypeId,
      status: leaveRequests.status,
      totalDays: leaveRequests.totalDays,
    })
    .from(leaveRequests)
    .where(
      and(
        eq(leaveRequests.locationId, locationId),
        eq(leaveRequests.staffId, applicant.staffId),
        inArray(leaveRequests.status, ['pending', 'approved']),
        lte(leaveRequests.startDate, end),
        gte(leaveRequests.endDate, start),
      ),
    );

  const takenBy = new Map<string, number>();
  const pendingBy = new Map<string, number>();

  for (const row of spent) {
    const target = row.status === 'approved' ? takenBy : pendingBy;
    target.set(
      row.leaveTypeId,
      (target.get(row.leaveTypeId) ?? 0) + Number.parseFloat(row.totalDays),
    );
  }

  return {
    year,
    quotas: mine.map((head) => ({
      leaveTypeId: head.id,
      leaveTypeName: head.name,
      isPaid: head.isPaid,
      annualQuotaDays: head.annualQuotaDays,
      ...computeQuota({
        annualQuotaDays: head.annualQuotaDays,
        permanentFrom: applicant.permanentFrom,
        year,
        takenDays: takenBy.get(head.id) ?? 0,
        pendingDays: pendingBy.get(head.id) ?? 0,
      }),
    })),
  };
}

/** This person's own requests, newest first, for the self-service screen. */
export async function listOwnLeaveRequests(
  locationId: string,
  staffId: string,
): Promise<LeaveRow[]> {
  const rows = await listLeaveForSchool(locationId);
  return rows.filter((row) => row.staffId === staffId);
}

/**
 * The requests one person already holds in a window — the overlap test's input.
 *
 * Narrow on purpose: the test needs dates and a state, and reading the whole
 * row would invite somebody to use this for a screen it is not scoped for.
 */
export async function leaveSpansFor(
  locationId: string,
  staffId: string,
): Promise<Array<{ id: string; startDate: string; endDate: string; status: string; leaveTypeName: string }>> {
  return db
    .select({
      id: leaveRequests.id,
      startDate: leaveRequests.startDate,
      endDate: leaveRequests.endDate,
      status: leaveRequests.status,
      leaveTypeName: leaveTypes.name,
    })
    .from(leaveRequests)
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
    .where(
      and(
        eq(leaveRequests.locationId, locationId),
        eq(leaveRequests.staffId, staffId),
        inArray(leaveRequests.status, ['pending', 'approved']),
      ),
    );
}

/** How many people are waiting on this person, for the dashboard tile. */
export async function countPendingLeave(locationId: string): Promise<number> {
  const rows = await db
    .select({ total: sql<number>`count(*)`.mapWith(Number) })
    .from(leaveRequests)
    .where(
      and(eq(leaveRequests.locationId, locationId), eq(leaveRequests.status, 'pending')),
    );

  return rows[0]?.total ?? 0;
}
