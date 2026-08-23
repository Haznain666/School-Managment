import 'server-only';

import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';

import {
  attendanceRecords,
  emailOutbox,
  examSubjects,
  exams,
  grades,
  leaveRequests,
  sections,
  studentEnrollments,
} from '@/db/schema';

import { db } from './drizzle';
import { toDateOnly } from './fee-queries';
import type { PrincipalScope } from './principal-resolver';
import { type AggregateScope, EVERY_GRADE } from './dashboard-queries';

/**
 * The two things the school-admin dashboard needs that no feature module owns:
 * BR4's scope resolved into something an aggregate can filter on, and the
 * morning's exceptions.
 *
 * ── Why the exceptions are one read and not five screens ─────────────────
 * An administrator's morning is exception handling, and before this the five
 * facts below were found by visiting five different screens — the outstanding
 * list, the attendance register, the marks sheets, the leave queue and the
 * super-admin email card. Nothing told them which of the five was worth opening
 * today, so the answer in practice was "whichever one somebody complained
 * about".
 *
 * Each count is a link and each is hidden at zero. A strip that is loud when
 * everything is fine trains people to ignore it on the day it is not — the same
 * reasoning as `EmailDeliveryHealth`'s quiet line.
 */

/* -----------------------------------------------------------------------------
 * BR4 — the principal scope, as a grade list.
 * -------------------------------------------------------------------------- */

/** The scope, plus the flag that decides whether the page explains itself. */
export interface DashboardScope extends AggregateScope {
  /** True for a head at a `multiple` school with no assignment yet. */
  unassigned: boolean;
}

/**
 * Turns a `PrincipalScope` into the one list every aggregate can filter on.
 *
 * The two axes collapse into grades because that is how the rest of the product
 * already narrows a head: `listStudents` filters campuses through
 * `grades.branch_id`, so a branch reaches its data through its grades and
 * nothing is lost by resolving them together. What is gained is that every
 * aggregate takes one argument, and "is this query scoped" is answerable by
 * reading one line of it rather than by tracing two joins.
 *
 * ── A grade with no campus belongs to every head ─────────────────────────
 * `grades.branch_id` is nullable, and a null one is a school-wide grade.
 * `scopeAdmitsBranch` admits it for exactly this reason, and so does this: a
 * single-campus school that has never created a branch record has *every* grade
 * null, and excluding them would show every one of its heads an empty school.
 *
 * ── An unassigned head resolves to `[]`, not to everything ───────────────
 * Empty is the honest answer and the aggregates short-circuit on it. The
 * dangerous bug here is the opposite one: treating "no assignment" as "no
 * filter" hands a head the whole school's finances, and the screen that results
 * looks entirely normal.
 */
export async function resolveDashboardScope(
  locationId: string,
  scope: PrincipalScope,
): Promise<DashboardScope> {
  if (!scope.scoped) return { ...EVERY_GRADE, unassigned: false };
  if (scope.unassigned) return { gradeIds: [], unassigned: true };
  if (scope.branchIds === null && scope.gradeIds === null) {
    return { ...EVERY_GRADE, unassigned: false };
  }

  const rows = await db
    .select({ id: grades.id })
    .from(grades)
    .where(
      and(
        eq(grades.locationId, locationId),
        scope.branchIds === null
          ? undefined
          : scope.branchIds.length === 0
            ? isNull(grades.branchId)
            : or(isNull(grades.branchId), inArray(grades.branchId, scope.branchIds)),
        scope.gradeIds === null
          ? undefined
          : scope.gradeIds.length === 0
            ? sql`false`
            : inArray(grades.id, scope.gradeIds),
      ),
    );

  return { gradeIds: rows.map((row) => row.id), unassigned: false };
}

/* -----------------------------------------------------------------------------
 * The exceptions strip.
 * -------------------------------------------------------------------------- */

/** One thing that is wrong right now, with somewhere to go about it. */
export interface DashboardException {
  key: string;
  count: number;
  label: string;
  href: string;
}

/** Which exceptions the caller is entitled to be shown at all. */
export interface ExceptionGates {
  fees: boolean;
  attendance: boolean;
  exams: boolean;
  hr: boolean;
  email: boolean;
}

/**
 * Sections that have students but no register taken today.
 *
 * Counted by difference in TypeScript rather than by a `NOT EXISTS` because
 * both halves are small — a school has tens of sections, not thousands — and
 * the anti-join form of this query is the kind that silently returns every
 * section the day somebody adds a join condition to the wrong side.
 *
 * A section with no active enrolment is not an exception. An empty class cannot
 * have its register taken, and listing it would put a permanent red number on
 * the screen that no action clears.
 */
async function sectionsMissingRegister(
  locationId: string,
  academicYearId: string,
  scope: AggregateScope,
  today: string,
): Promise<number> {
  if (scope.gradeIds !== null && scope.gradeIds.length === 0) return 0;

  const [withStudents, marked] = await Promise.all([
    db
      .selectDistinct({ sectionId: studentEnrollments.sectionId })
      .from(studentEnrollments)
      .innerJoin(
        sections,
        and(eq(sections.id, studentEnrollments.sectionId), eq(sections.locationId, locationId)),
      )
      .where(
        and(
          eq(studentEnrollments.locationId, locationId),
          eq(studentEnrollments.academicYearId, academicYearId),
          eq(studentEnrollments.status, 'active'),
          scope.gradeIds === null ? undefined : inArray(sections.gradeId, scope.gradeIds),
        ),
      ),
    db
      .selectDistinct({ sectionId: studentEnrollments.sectionId })
      .from(attendanceRecords)
      .innerJoin(
        studentEnrollments,
        and(
          eq(studentEnrollments.id, attendanceRecords.enrollmentId),
          eq(studentEnrollments.locationId, locationId),
        ),
      )
      .where(
        and(eq(attendanceRecords.locationId, locationId), eq(attendanceRecords.date, today)),
      ),
  ]);

  const done = new Set(marked.map((row) => row.sectionId));
  return withStudents.filter((row) => !done.has(row.sectionId)).length;
}

/**
 * Papers whose exam has been sat and whose marks are still a draft.
 *
 * ── The deadline this stands in for ──────────────────────────────────────
 * The spec asks for "marks not entered past their deadline". `exam_subjects`
 * carries no deadline column and Sprint 15 adds no migration, so the exam's own
 * date is the deadline used: a paper sat last Tuesday whose results are still
 * `draft` is late by any school's reckoning, and one sat tomorrow is not late
 * by anybody's. When a deadline column arrives this is the one line to change.
 *
 * Archived papers and archived exams are excluded — a cancelled datesheet is
 * not an outstanding task.
 */
async function papersAwaitingMarks(
  locationId: string,
  scope: AggregateScope,
  today: string,
): Promise<number> {
  if (scope.gradeIds !== null && scope.gradeIds.length === 0) return 0;

  const rows = await db
    .select({ value: sql<number>`count(*)`.mapWith(Number) })
    .from(examSubjects)
    .innerJoin(
      exams,
      and(eq(exams.id, examSubjects.examId), eq(exams.locationId, locationId)),
    )
    .where(
      and(
        eq(examSubjects.locationId, locationId),
        eq(examSubjects.resultsStatus, 'draft'),
        lt(exams.examDate, today),
        isNull(exams.archivedAt),
        isNull(examSubjects.archivedAt),
        scope.gradeIds === null ? undefined : inArray(exams.gradeId, scope.gradeIds),
      ),
    );

  return rows[0]?.value ?? 0;
}

/**
 * The morning's exceptions, in the order an administrator acts on them.
 *
 * Money first, because it is the one with a date attached; then the register,
 * which can still be taken today; then marks, leave and mail, which can wait an
 * hour. Anything the caller may not see is not counted rather than counted and
 * hidden — a gate that only hides the row still pays for the query.
 *
 * Leave and email are *not* grade-scoped, and deliberately: a leave request is
 * a staff record and an undelivered email is a platform fact. Neither belongs
 * to a division, so narrowing them by grade would silently zero both for every
 * principal at a multi-head school.
 */
export async function getDashboardExceptions(
  locationId: string,
  scope: AggregateScope,
  gates: ExceptionGates,
  context: { academicYearId: string | null; overdueChallans: number },
  now: Date = new Date(),
): Promise<DashboardException[]> {
  const today = toDateOnly(now);

  const [unmarked, latePapers, pendingLeave, failedEmail] = await Promise.all([
    gates.attendance && context.academicYearId !== null
      ? sectionsMissingRegister(locationId, context.academicYearId, scope, today)
      : 0,
    gates.exams ? papersAwaitingMarks(locationId, scope, today) : 0,
    gates.hr
      ? db
          .select({ value: sql<number>`count(*)`.mapWith(Number) })
          .from(leaveRequests)
          .where(
            and(
              eq(leaveRequests.locationId, locationId),
              eq(leaveRequests.status, 'pending'),
            ),
          )
          .then((rows) => rows[0]?.value ?? 0)
      : 0,
    gates.email
      ? db
          .select({ value: sql<number>`count(*)`.mapWith(Number) })
          .from(emailOutbox)
          .where(
            and(eq(emailOutbox.locationId, locationId), eq(emailOutbox.status, 'failed')),
          )
          .then((rows) => rows[0]?.value ?? 0)
      : 0,
  ]);

  const all: DashboardException[] = [
    {
      key: 'overdue',
      count: gates.fees ? context.overdueChallans : 0,
      label: 'challans past their due date',
      href: '/dashboard/fees/defaulters',
    },
    {
      key: 'register',
      count: unmarked,
      label: 'classes with no register taken today',
      href: '/dashboard/academics/attendance',
    },
    {
      key: 'marks',
      count: latePapers,
      label: 'papers sat with marks still unentered',
      href: '/dashboard/exams',
    },
    {
      key: 'leave',
      count: pendingLeave,
      label: 'leave requests awaiting a decision',
      href: '/dashboard/hr/leave',
    },
    {
      key: 'email',
      count: failedEmail,
      label: 'emails the mail server refused',
      href: '/dashboard/communications',
    },
  ];

  return all.filter((entry) => entry.count > 0);
}
