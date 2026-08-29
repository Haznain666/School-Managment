import 'server-only';

import { and, asc, desc, eq } from 'drizzle-orm';

import {
  leaveRequests,
  leaveTypes,
  payrollRuns,
  payslips,
  staff,
} from '@/db/schema';

import { sharedOrOwnedBy } from './branch-scope';
import { db } from './drizzle';

/**
 * `lib/staff-self-queries.ts` — a member of staff reading their own record.
 *
 * ── Why this is not `lib/hr-queries.ts` ──────────────────────────────────
 * That module answers HR's questions: list the staff, filter by branch, tally
 * the leave. Every function there takes a `staffId` chosen by an administrator
 * who is entitled to choose any of them. This module answers one question — my
 * payslips, my leave — and the staff record is never chosen, it is *derived*
 * from the signed-in session through `staff.school_user_id`.
 *
 * Keeping them apart is the point. A helper that took a `staffId` and was used
 * by both would be one forgotten check away from letting a teacher read a
 * colleague's salary, and salary is the single most sensitive number in this
 * schema. Here there is no id to forget to check, because the caller cannot
 * supply one.
 *
 * ── A teacher with no staff record is a real state ───────────────────────
 * Portal accounts and HR records are created by different people at different
 * times, and a teacher may be teaching for weeks before HR enters them. Every
 * function returns empty rather than throwing, and the screens say "your staff
 * record has not been set up yet" — which is actionable — rather than showing
 * an error, which is not.
 */

/** The staff record belonging to a portal account, if HR has created one. */
export async function staffIdForSchoolUser(
  locationId: string,
  schoolUserId: string,
): Promise<string | null> {
  const rows = await db
    .select({ id: staff.id })
    .from(staff)
    .where(and(eq(staff.locationId, locationId), eq(staff.schoolUserId, schoolUserId)))
    .limit(1);

  return rows[0]?.id ?? null;
}

export interface OwnPayslipRow {
  id: string;
  payslipNumber: string;
  payrollMonth: number;
  payrollYear: number;
  grossEarnings: string;
  totalDeductions: string;
  netPayable: string;
  status: string;
  paidOn: string | null;
  paymentMode: string | null;
}

/**
 * This person's own payslips, newest first.
 *
 * ── Only from a paid or approved run ─────────────────────────────────────
 * A payslip belonging to a run that is still being computed is a draft figure,
 * and a teacher who sees one and then sees a different number on payday has
 * been told something untrue by their employer's software. Sprint 7 made
 * approval the deliberate act; this is where that decision is honoured on the
 * staff side.
 */
export async function listOwnPayslips(
  locationId: string,
  staffId: string,
): Promise<OwnPayslipRow[]> {
  return db
    .select({
      id: payslips.id,
      payslipNumber: payslips.payslipNumber,
      payrollMonth: payrollRuns.payrollMonth,
      payrollYear: payrollRuns.payrollYear,
      grossEarnings: payslips.grossEarnings,
      totalDeductions: payslips.totalDeductions,
      netPayable: payslips.netPayable,
      status: payslips.status,
      paidOn: payslips.paidOn,
      paymentMode: payslips.paymentMode,
    })
    .from(payslips)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.payrollRunId))
    .where(
      and(
        eq(payslips.locationId, locationId),
        eq(payslips.staffId, staffId),
        // Anything earlier than this is a working figure, not a payslip.
        eq(payrollRuns.status, 'paid'),
      ),
    )
    .orderBy(desc(payrollRuns.payrollYear), desc(payrollRuns.payrollMonth));
}

export interface OwnLeaveRow {
  id: string;
  leaveTypeName: string;
  isPaid: boolean;
  startDate: string;
  endDate: string;
  totalDays: string;
  reason: string | null;
  status: string;
  decisionNote: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}

/** This person's own leave requests, newest first. */
export async function listOwnLeave(
  locationId: string,
  staffId: string,
): Promise<OwnLeaveRow[]> {
  return db
    .select({
      id: leaveRequests.id,
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
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
    .where(
      and(eq(leaveRequests.locationId, locationId), eq(leaveRequests.staffId, staffId)),
    )
    .orderBy(desc(leaveRequests.startDate));
}

/**
 * Leave types this school offers, for the request form.
 *
 * `branchIds` is the campus this member belongs to, so a school group that has
 * given one campus its own leave head does not offer it to the rest. Shared
 * heads — a null `branch_id`, which is every head in production today — are
 * offered to everybody, which is what `sharedOrOwnedBy` is for and why an `eq`
 * here would empty the dropdown at every school.
 *
 * `null` reads every campus and is what a caller with no campus gets, which is
 * the behaviour this had before Sprint 19a.
 */
export async function listLeaveTypeOptions(
  locationId: string,
  branchIds: string[] | null = null,
): Promise<{ id: string; name: string; isPaid: boolean }[]> {
  return db
    .select({ id: leaveTypes.id, name: leaveTypes.name, isPaid: leaveTypes.isPaid })
    .from(leaveTypes)
    .where(
      and(
        eq(leaveTypes.locationId, locationId),
        eq(leaveTypes.isActive, true),
        sharedOrOwnedBy(leaveTypes.branchId, branchIds),
      ),
    )
    .orderBy(asc(leaveTypes.name));
}
