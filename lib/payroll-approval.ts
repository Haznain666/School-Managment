import 'server-only';

import { and, asc, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';

import {
  payrollRunApprovals,
  payrollRuns,
  payslips,
  principalAssignments,
  schoolUsers,
  sections,
  staff,
  timetableEntries,
} from '@/db/schema';

import { db, type Tx } from './drizzle';
import { getPrincipalModel } from './principal-resolver';

/**
 * Who signs off which part of a payroll run (Sprint 27, Part C).
 *
 * ── The rule, in the product owner's words ───────────────────────────────
 * *Only teachers' and coordinators' payroll comes to the principal. A principal
 * assigned a whole campus approves every teacher and coordinator at it. Where a
 * school runs several principals, each approves those that fall under their own
 * grades.*
 *
 * So approval is **per head over a slice of the run**, and the run advances
 * when every slice is signed. That is why `payroll_run_approvals` has a row per
 * head rather than `payroll_runs` having a second `approved_by`: a Junior
 * School head may have signed her forty teachers while the Senior School head
 * has not opened the screen, and a single column cannot say so.
 *
 * ── A school with no principal is not blocked, and that is deliberate ────
 * `resolveRunApprovers` returns no approvers for a school that has never
 * appointed one, and the route treats that as *no approval required* — the run
 * behaves exactly as it did before this sprint. A feature that froze a working
 * school's payroll behind a role they do not have would be a regression wearing
 * a governance costume.
 *
 * ── And staff nobody covers are named, not hidden ────────────────────────
 * A teacher in a grade no assignment mentions is returned as `uncovered`. The
 * screen says so and `payroll.write` may sign that slice itself. Silently
 * blocking a run because an assignment is missing is a payroll nobody can run
 * and no screen explaining why.
 */

/** Roles whose payslips go to a head at all. Everybody else does not. */
const APPROVED_ROLES = new Set(['teacher', 'coordinator']);

/**
 * Designations that mean "teacher" or "coordinator" for somebody with no login.
 *
 * The fallback the requirement forces: `staff.school_user_id` is Sprint 22's
 * link and it is nullable, because a school may keep an employment record for
 * a person who never signs in. Their designation is the only thing left that
 * says what they do, and it is free text on a contract — so this matches on a
 * *substring*, case-insensitively, and errs towards including somebody rather
 * than routing their payslip past the head who is answerable for them.
 */
const DESIGNATION_HINTS = ['teacher', 'coordinator', 'coordinater'];

function roleFromDesignation(designation: string | null): string | null {
  if (designation === null) return null;

  const lowered = designation.toLowerCase();
  for (const hint of DESIGNATION_HINTS) {
    if (lowered.includes(hint)) {
      return hint === 'coordinator' || hint === 'coordinater' ? 'coordinator' : 'teacher';
    }
  }

  return null;
}

/** One payslip's staff member, as the resolver needs them. */
export interface CoverableStaff {
  payslipId: string;
  staffId: string;
  staffName: string;
  branchId: string | null;
  /** `teacher`, `coordinator`, or null for everybody else. */
  role: string | null;
  /** Distinct grades this person teaches or is class teacher of. */
  gradeIds: string[];
}

/** One head, and the payslips they cover. */
export interface RunApprover {
  principalUserId: string;
  principalName: string;
  payslipIds: string[];
  staffCount: number;
}

export interface RunApprovers {
  approvers: RunApprover[];
  /** Teachers and coordinators no live assignment reaches, named. */
  uncovered: Array<{ payslipId: string; staffName: string }>;
  /** True when the school has no principal at all, so nobody has to sign. */
  noPrincipal: boolean;
}

/**
 * The grades each of these staff members teaches.
 *
 * ── Two axes, because a coordinator has no timetable ─────────────────────
 * A subject teacher is reached through `timetable_entries.teacher_id`, which
 * points at the **portal account** (`staff.school_user_id`), not at the
 * employment record. A class teacher is reached through
 * `sections.class_teacher_id`, which points at the **employment record**. Two
 * different columns pointing at two different tables for two different facts —
 * reading either into the other silently matches nothing, which is the worst
 * failure available here because an empty grade list is indistinguishable from
 * a teacher with no classes.
 *
 * A coordinator with no timetable and no section comes back with no grades and
 * is reached by the branch axis only. That is correct: a coordinator belongs to
 * a campus.
 */
async function gradesByStaff(
  locationId: string,
  staffIds: readonly string[],
): Promise<Map<string, string[]>> {
  const byStaff = new Map<string, Set<string>>();
  if (staffIds.length === 0) return new Map();

  const timetabled = await db
    .selectDistinct({ staffId: staff.id, gradeId: sections.gradeId })
    .from(timetableEntries)
    .innerJoin(staff, eq(staff.schoolUserId, timetableEntries.teacherId))
    .innerJoin(sections, eq(sections.id, timetableEntries.sectionId))
    .where(
      and(
        eq(timetableEntries.locationId, locationId),
        eq(timetableEntries.isActive, true),
        inArray(staff.id, [...staffIds]),
      ),
    );

  const homeRooms = await db
    .selectDistinct({ staffId: sections.classTeacherId, gradeId: sections.gradeId })
    .from(sections)
    .where(
      and(
        eq(sections.locationId, locationId),
        inArray(sections.classTeacherId, [...staffIds]),
      ),
    );

  for (const row of [...timetabled, ...homeRooms]) {
    if (row.staffId === null) continue;
    const held = byStaff.get(row.staffId) ?? new Set<string>();
    held.add(row.gradeId);
    byStaff.set(row.staffId, held);
  }

  return new Map([...byStaff].map(([staffId, held]) => [staffId, [...held]]));
}

/** Every live principal assignment at this school, today. */
async function liveAssignments(
  locationId: string,
): Promise<
  Array<{
    schoolUserId: string;
    principalName: string;
    branchId: string | null;
    gradeIds: string[];
  }>
> {
  const now = new Date().toISOString().slice(0, 10);

  return db
    .select({
      schoolUserId: principalAssignments.schoolUserId,
      principalName: schoolUsers.name,
      branchId: principalAssignments.branchId,
      gradeIds: principalAssignments.gradeIds,
    })
    .from(principalAssignments)
    .innerJoin(schoolUsers, eq(schoolUsers.id, principalAssignments.schoolUserId))
    .where(
      and(
        eq(principalAssignments.locationId, locationId),
        // `lte` / `gte` and `isNull`, never a raw `sql` template. CLAUDE.md's
        // rule, and the same three predicates `claimedGrades` uses so the two
        // agree about which assignments are live — an assignment that starts
        // next term must not be signing this month's payroll.
        lte(principalAssignments.startsOn, now),
        or(
          isNull(principalAssignments.endsOn),
          gte(principalAssignments.endsOn, now),
        ),
      ),
    )
    .orderBy(asc(schoolUsers.name));
}

/** The payslips in a run whose staff member could need a head's approval. */
export async function coverableStaffFor(
  locationId: string,
  runId: string,
): Promise<CoverableStaff[]> {
  const rows = await db
    .select({
      payslipId: payslips.id,
      staffId: staff.id,
      staffName: payslips.staffName,
      branchId: staff.branchId,
      designation: staff.designation,
      role: schoolUsers.role,
    })
    .from(payslips)
    .innerJoin(staff, eq(staff.id, payslips.staffId))
    .leftJoin(schoolUsers, eq(schoolUsers.id, staff.schoolUserId))
    .where(and(eq(payslips.locationId, locationId), eq(payslips.payrollRunId, runId)))
    .orderBy(asc(payslips.staffName));

  const needing = rows.filter((row) =>
    row.role === null
      ? roleFromDesignation(row.designation) !== null
      : APPROVED_ROLES.has(row.role),
  );

  const gradeMap = await gradesByStaff(
    locationId,
    needing.map((row) => row.staffId),
  );

  return needing.map((row) => ({
    payslipId: row.payslipId,
    staffId: row.staffId,
    staffName: row.staffName,
    branchId: row.branchId,
    role: row.role === null ? roleFromDesignation(row.designation) : row.role,
    gradeIds: gradeMap.get(row.staffId) ?? [],
  }));
}

/**
 * Who must sign this run, and whom nobody covers.
 *
 * ── `single` and `multiple` are genuinely different questions ────────────
 * A school on `principal_model = 'single'` has one head who runs the school, so
 * they cover every teacher and coordinator in the run and there is nothing to
 * intersect. A school on `multiple` has assignments, and each one covers a
 * person when either axis matches: the assignment's campus is that person's
 * campus, **or** the assignment's grades intersect the grades they teach.
 *
 * Either, not both. A coordinator with no timetable has no grades and would
 * fall through an `AND`; a peripatetic music teacher timetabled across two
 * campuses would fall through it the other way. The union is what makes every
 * one of them somebody's responsibility.
 */
export async function resolveRunApprovers(
  locationId: string,
  runId: string,
): Promise<RunApprovers> {
  const coverable = await coverableStaffFor(locationId, runId);

  if (coverable.length === 0) {
    return { approvers: [], uncovered: [], noPrincipal: false };
  }

  const model = await getPrincipalModel(locationId);

  if (model === 'single') {
    const heads = await db
      .select({ id: schoolUsers.id, name: schoolUsers.name })
      .from(schoolUsers)
      .where(
        and(
          eq(schoolUsers.locationId, locationId),
          eq(schoolUsers.role, 'principal'),
          eq(schoolUsers.isActive, true),
        ),
      )
      .orderBy(asc(schoolUsers.name))
      .limit(1);

    const head = heads[0];

    // No principal at all. Not an error and not something to block on — the run
    // behaves exactly as it did before this sprint existed.
    if (head === undefined) {
      return { approvers: [], uncovered: [], noPrincipal: true };
    }

    return {
      approvers: [
        {
          principalUserId: head.id,
          principalName: head.name,
          payslipIds: coverable.map((row) => row.payslipId),
          staffCount: coverable.length,
        },
      ],
      uncovered: [],
      noPrincipal: false,
    };
  }

  const assignments = await liveAssignments(locationId);

  if (assignments.length === 0) {
    return { approvers: [], uncovered: [], noPrincipal: true };
  }

  const byPrincipal = new Map<string, RunApprover>();
  const uncovered: RunApprovers['uncovered'] = [];

  for (const person of coverable) {
    let covered = false;

    for (const assignment of assignments) {
      const byBranch =
        assignment.branchId !== null && assignment.branchId === person.branchId;
      const byGrade = assignment.gradeIds.some((gradeId) =>
        person.gradeIds.includes(gradeId),
      );

      if (!byBranch && !byGrade) continue;

      const slice = byPrincipal.get(assignment.schoolUserId) ?? {
        principalUserId: assignment.schoolUserId,
        principalName: assignment.principalName,
        payslipIds: [],
        staffCount: 0,
      };

      // A head with two assignments that both reach the same person signs for
      // them once. Without the guard the run would wait for one signature and
      // count two.
      if (!slice.payslipIds.includes(person.payslipId)) {
        slice.payslipIds.push(person.payslipId);
        slice.staffCount += 1;
      }

      byPrincipal.set(assignment.schoolUserId, slice);
      covered = true;
    }

    if (!covered) {
      uncovered.push({ payslipId: person.payslipId, staffName: person.staffName });
    }
  }

  return {
    approvers: [...byPrincipal.values()].sort((left, right) =>
      left.principalName.localeCompare(right.principalName),
    ),
    uncovered,
    noPrincipal: byPrincipal.size === 0 && uncovered.length === coverable.length,
  };
}

/**
 * Writes the approval rows for a run, replacing whatever was there.
 *
 * ── Replaced, not merged ─────────────────────────────────────────────────
 * A rejected run goes back to `draft`, somebody fixes something, and it is
 * submitted again. Keeping the old rows would carry a head's approval of
 * numbers that have since changed — a signature on a document that was then
 * edited, which is the one thing a signature must never be.
 *
 * Built on `tx` and never on `db`. A statement built from `db` runs outside the
 * transaction even when awaited inside one (`lib/drizzle.ts` says so), and
 * approval rows that committed separately from the status change would leave a
 * run pending with nobody assigned to it.
 */
export async function writeApprovalRows(
  tx: Tx,
  locationId: string,
  runId: string,
  approvers: readonly RunApprover[],
): Promise<void> {
  await tx
    .delete(payrollRunApprovals)
    .where(
      and(
        eq(payrollRunApprovals.locationId, locationId),
        eq(payrollRunApprovals.payrollRunId, runId),
      ),
    );

  if (approvers.length === 0) return;

  await tx.insert(payrollRunApprovals).values(
    approvers.map((approver) => ({
      locationId,
      payrollRunId: runId,
      principalUserId: approver.principalUserId,
      status: 'pending' as const,
      staffCount: approver.staffCount,
    })),
  );
}

export interface ApprovalRow {
  id: string;
  principalUserId: string;
  principalName: string;
  status: string;
  staffCount: number;
  note: string | null;
  decidedAt: Date | null;
}

/** The slices of one run and where each stands. */
export async function listRunApprovals(
  locationId: string,
  runId: string,
): Promise<ApprovalRow[]> {
  return db
    .select({
      id: payrollRunApprovals.id,
      principalUserId: payrollRunApprovals.principalUserId,
      principalName: schoolUsers.name,
      status: payrollRunApprovals.status,
      staffCount: payrollRunApprovals.staffCount,
      note: payrollRunApprovals.note,
      decidedAt: payrollRunApprovals.decidedAt,
    })
    .from(payrollRunApprovals)
    .innerJoin(schoolUsers, eq(schoolUsers.id, payrollRunApprovals.principalUserId))
    .where(
      and(
        eq(payrollRunApprovals.locationId, locationId),
        eq(payrollRunApprovals.payrollRunId, runId),
      ),
    )
    .orderBy(asc(schoolUsers.name));
}

export interface AwaitingRun {
  runId: string;
  payrollMonth: number;
  payrollYear: number;
  branchId: string | null;
  netTotal: string;
  staffCount: number;
  approvalStatus: string;
}

/**
 * Runs waiting on this head, newest first.
 *
 * The whole of `/dashboard/payroll/approvals`. Filtered on the *approval* row
 * rather than on the run's status, because a head who has already signed must
 * still be able to see what they signed while the run waits for somebody else.
 */
export async function runsAwaiting(
  locationId: string,
  principalUserId: string,
): Promise<AwaitingRun[]> {
  return db
    .select({
      runId: payrollRuns.id,
      payrollMonth: payrollRuns.payrollMonth,
      payrollYear: payrollRuns.payrollYear,
      branchId: payrollRuns.branchId,
      netTotal: payrollRuns.netTotal,
      staffCount: payrollRunApprovals.staffCount,
      approvalStatus: payrollRunApprovals.status,
    })
    .from(payrollRunApprovals)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollRunApprovals.payrollRunId))
    .where(
      and(
        eq(payrollRunApprovals.locationId, locationId),
        eq(payrollRunApprovals.principalUserId, principalUserId),
      ),
    )
    .orderBy(asc(payrollRuns.payrollYear), asc(payrollRuns.payrollMonth));
}
