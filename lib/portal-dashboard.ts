import 'server-only';

import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import {
  attendanceRecords,
  leaveRequests,
  studentEnrollments,
  type PromotionStatus,
} from '@/db/schema';

import {
  listSlotsForSection,
  listSlotsForTeacher,
  listStudentAttendance,
  listTeacherSections,
  listTeacherTimetable,
  listTimetableEntries,
  summariseAttendance,
  type AttendanceSummary,
  type StudentAttendanceRecordRow,
  type TeacherSectionOption,
} from './academics-queries';
import { db } from './drizzle';
import {
  listTeacherPapers,
  type StudentTermHistoryRow,
  type TeacherPaperRow,
} from './exam-queries';
import { toDateOnly } from './fee-queries';
import { weekStartingOf, listOwnPlans } from './lesson-plan-queries';
import {
  listPublishedTermsForStudent,
  listStudentExams,
  listStudentResultHistory,
} from './portal-results';

/**
 * The reads behind the teacher, parent and student dashboards.
 *
 * ── Why these live together ──────────────────────────────────────────────
 * All three portals answer the same shape of question — "what is true about
 * *me* right now" — and all three assemble it from four or five feature modules
 * that know nothing about each other. Putting the assembly in the pages would
 * put the same five joins in three route files; putting it in the feature
 * modules would give `lib/exam-queries.ts` a reason to import attendance.
 *
 * ── Every read here is already authorised by its arguments ───────────────
 * A teacher id, a student profile id and a location id, all three resolved from
 * the verified session by the caller. There is no id from a URL in this file,
 * and the underlying queries — `listTeacherSections`, `listTeacherPapers`,
 * `listPublishedTermsForStudent` — are themselves the authorisation lists their
 * own modules use.
 *
 * ── Published only, on the family side ───────────────────────────────────
 * A parent or student sees a result when the school has published the term and
 * not before. `listPublishedTermsForStudent` is that guard and it is the only
 * route to a result in here.
 */

/* -----------------------------------------------------------------------------
 * Teacher.
 * -------------------------------------------------------------------------- */

/** Monday is 0 in `timetable_entries.day_of_week`; the weekend is not a day. */
export function weekdayIndex(now: Date = new Date()): number | null {
  const index = (now.getDay() + 6) % 7;
  return index <= 4 ? index : null;
}

/** `HH:MM` -> minutes past midnight, for "which period is running now". */
function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map((part) => Number.parseInt(part, 10));
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

/** One row of today's timetable, as the teacher's dashboard prints it. */
export interface TeacherPeriod {
  slotId: string;
  sectionId: string;
  name: string;
  startTime: string;
  endTime: string;
  isBreak: boolean;
  className: string;
  subjectName: string;
  room: string | null;
  /** True for the period the clock is inside right now. */
  isNow: boolean;
  isPast: boolean;
}

/**
 * Today's periods for one teacher, in clock order.
 *
 * `listSlotsForTeacher`, never the unscoped `listTimetableSlots` — CLAUDE.md.
 * A physicist who takes one junior class teaches inside two bell schedules and
 * neither alone can draw her day; the unscoped call would draw both in full,
 * including the periods that can never be filled.
 *
 * Free periods are kept as rows with no subject. A teacher reading their day
 * needs the gaps as much as the lessons, and a list that silently closes them
 * up makes 11:00 look like it follows 09:40.
 */
export async function getTeacherDay(
  locationId: string,
  teacherId: string,
  academicYearId: string,
  now: Date = new Date(),
): Promise<TeacherPeriod[]> {
  const day = weekdayIndex(now);
  if (day === null) return [];

  const [slots, entries] = await Promise.all([
    listSlotsForTeacher(locationId, teacherId, academicYearId),
    listTeacherTimetable(locationId, teacherId, academicYearId),
  ]);

  const today = entries.filter((entry) => entry.dayOfWeek === day);
  const bySlot = new Map(today.map((entry) => [entry.slotId, entry]));
  const minutesNow = now.getHours() * 60 + now.getMinutes();

  return slots
    .filter((slot) => bySlot.has(slot.id) || !slot.isBreak)
    .map((slot) => {
      const entry = bySlot.get(slot.id);
      const start = minutesOf(slot.startTime);
      const end = minutesOf(slot.endTime);

      return {
        slotId: slot.id,
        sectionId: entry?.sectionId ?? '',
        name: slot.name,
        startTime: slot.startTime,
        endTime: slot.endTime,
        isBreak: slot.isBreak,
        className: entry === undefined ? '' : `${entry.gradeName} — ${entry.sectionName}`,
        subjectName: entry?.subjectName ?? '',
        room: entry?.room ?? null,
        isNow: minutesNow >= start && minutesNow < end,
        isPast: minutesNow >= end,
      };
    });
}

/** The four things a teacher can be behind on. */
export interface TeacherTasks {
  /** Classes they teach whose register has not been taken today. */
  unmarkedSections: TeacherSectionOption[];
  /** Papers they own that have been sat and are still a draft. */
  papersOutstanding: TeacherPaperRow[];
  /** Section/subject pairs with no lesson plan for next week. */
  plansMissingNextWeek: number;
  /** Their own leave requests still awaiting a decision. */
  leaveAwaitingDecision: number;
}

/**
 * Everything waiting on this teacher, in one read.
 *
 * ── The register is counted per section, not per period ──────────────────
 * A register is taken once a day for a class, so a teacher with four periods
 * of 8-B owes one register, not four. Counting periods would report a teacher
 * who has already marked their class as three tasks behind.
 *
 * ── "Outstanding" marks means sat, and still a draft ─────────────────────
 * The exam date is the deadline used, for the reason
 * `lib/school-dashboard.ts` gives at length: there is no deadline column and
 * this sprint adds no migration. A paper sat last Tuesday and still in draft is
 * late by anybody's reckoning; one sat tomorrow is not.
 */
export async function getTeacherTasks(
  locationId: string,
  teacherId: string,
  academicYearId: string,
  staffId: string | null,
  now: Date = new Date(),
): Promise<TeacherTasks> {
  const today = toDateOnly(now);
  const nextMonday = weekStartingOf(toDateOnly(new Date(now.getTime() + 7 * 86_400_000)));

  const [mySections, papers, entries, plans, leave] = await Promise.all([
    listTeacherSections(locationId, teacherId, academicYearId),
    listTeacherPapers(locationId, teacherId, academicYearId),
    listTeacherTimetable(locationId, teacherId, academicYearId),
    listOwnPlans(locationId, teacherId, { from: nextMonday, to: nextMonday }),
    staffId === null
      ? Promise.resolve(0)
      : db
          .select({ value: sql<number>`count(*)`.mapWith(Number) })
          .from(leaveRequests)
          .where(
            and(
              eq(leaveRequests.locationId, locationId),
              eq(leaveRequests.staffId, staffId),
              eq(leaveRequests.status, 'pending'),
            ),
          )
          .then((rows) => rows[0]?.value ?? 0),
  ]);

  const sectionIds = mySections.map((section) => section.sectionId);
  const done = await sectionsMarkedOn(locationId, sectionIds, today);

  const taught = new Set(entries.map((entry) => `${entry.sectionId}:${entry.subjectId}`));
  const planned = new Set(plans.map((plan) => `${plan.sectionId}:${plan.subjectId}`));

  return {
    unmarkedSections: mySections.filter((section) => !done.has(section.sectionId)),
    papersOutstanding: papers.filter(
      (paper) => paper.resultsStatus === 'draft' && paper.examDate < today,
    ),
    plansMissingNextWeek: [...taught].filter((key) => !planned.has(key)).length,
    leaveAwaitingDecision: leave,
  };
}

/**
 * Which of these sections had a register taken on `date`.
 *
 * ── Why this is exported, and not inlined where it is used ───────────────
 * It was inlined, behind an `if (sectionIds.length === 0) return` — which is
 * necessary, because `inArray(column, [])` is a pointless round trip and on
 * some Drizzle versions invalid SQL. But `check-portals` runs against a school
 * that does not exist, so the guard fired every time and *this join was the one
 * query the script never executed*. Lifting it out lets the script hand it a
 * section id and make Postgres parse, plan and run it.
 *
 * The join is tenant-filtered on both sides. A join predicate that omits the
 * location id is how a scoped query stops being scoped.
 */
export async function sectionsMarkedOn(
  locationId: string,
  sectionIds: readonly string[],
  date: string,
): Promise<Set<string>> {
  if (sectionIds.length === 0) return new Set();

  const rows = await db
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
      and(
        eq(attendanceRecords.locationId, locationId),
        eq(attendanceRecords.date, date),
        inArray(studentEnrollments.sectionId, [...sectionIds]),
      ),
    );

  return new Set(rows.map((row) => row.sectionId));
}

/** Active enrolment per section, and the last date each had a register. */
export async function sectionRegisterFacts(
  locationId: string,
  academicYearId: string,
  sectionIds: readonly string[],
): Promise<{ strength: Map<string, number>; lastRegister: Map<string, string> }> {
  if (sectionIds.length === 0) {
    return { strength: new Map(), lastRegister: new Map() };
  }

  const ids = [...sectionIds];

  const [strengths, lastMarks] = await Promise.all([
    db
      .select({
        sectionId: studentEnrollments.sectionId,
        value: sql<number>`count(*)`.mapWith(Number),
      })
      .from(studentEnrollments)
      .where(
        and(
          eq(studentEnrollments.locationId, locationId),
          eq(studentEnrollments.academicYearId, academicYearId),
          eq(studentEnrollments.status, 'active'),
          inArray(studentEnrollments.sectionId, ids),
        ),
      )
      .groupBy(studentEnrollments.sectionId),
    db
      .select({
        sectionId: studentEnrollments.sectionId,
        last: sql<string>`max(${attendanceRecords.date})`,
      })
      .from(attendanceRecords)
      .innerJoin(
        studentEnrollments,
        and(
          eq(studentEnrollments.id, attendanceRecords.enrollmentId),
          eq(studentEnrollments.locationId, locationId),
        ),
      )
      .where(
        and(
          eq(attendanceRecords.locationId, locationId),
          inArray(studentEnrollments.sectionId, ids),
        ),
      )
      .groupBy(studentEnrollments.sectionId),
  ]);

  return {
    strength: new Map(strengths.map((row) => [row.sectionId, row.value])),
    lastRegister: new Map(lastMarks.map((row) => [row.sectionId, row.last])),
  };
}

/** A class a teacher takes, with the two facts they ask about it. */
export interface TeacherClass extends TeacherSectionOption {
  strength: number;
  lastRegister: string | null;
}

/** Sections taught, their strength, and when the register was last taken. */
export async function getTeacherClasses(
  locationId: string,
  teacherId: string,
  academicYearId: string,
): Promise<TeacherClass[]> {
  const mySections = await listTeacherSections(locationId, teacherId, academicYearId);
  const sectionIds = mySections.map((section) => section.sectionId);
  if (sectionIds.length === 0) return [];

  const facts = await sectionRegisterFacts(locationId, academicYearId, sectionIds);
  const byStrength = facts.strength;
  const byLast = facts.lastRegister;

  return mySections.map((section) => ({
    ...section,
    strength: byStrength.get(section.sectionId) ?? 0,
    lastRegister: byLast.get(section.sectionId) ?? null,
  }));
}

/* -----------------------------------------------------------------------------
 * Parent and student.
 * -------------------------------------------------------------------------- */

/** One published term, reduced to the figures a family reads. */
export interface PublishedResult {
  termId: string;
  termName: string;
  academicYearName: string;
  gradeName: string;
  overallPercentage: number | null;
  overallGradeLabel: string | null;
  finalStatus: PromotionStatus;
  isOverridden: boolean;
}

/** One child's month, as both portals show it. */
export interface ChildSnapshot {
  attendance: AttendanceSummary;
  /** Daily 1/0 for the month so far, oldest first — the sparkline's values. */
  attendanceSeries: number[];
  records: StudentAttendanceRecordRow[];
  /** The next exam on the datesheet, or null when there is none. */
  nextExam: { title: string; examDate: string; termName: string } | null;
  /** The most recent term the school has actually published. */
  latestResult: PublishedResult | null;
  /** Every published term, oldest first — the student portal's trend line. */
  resultTrend: PublishedResult[];
  /** How many terms have a published card. */
  publishedTerms: number;
}

/** The month to date, as two `YYYY-MM-DD` strings. */
export function monthToDate(now: Date = new Date()): { from: string; to: string } {
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: toDateOnly(first), to: toDateOnly(now) };
}

/**
 * A child's month, next exam and latest published result, in one read.
 *
 * ── The sparkline is per day, and holidays are not zeroes ────────────────
 * `summariseAttendance` already excludes `holiday` from the rate, and the
 * series does the same by omitting the day rather than plotting it as an
 * absence. A sparkline that dips through every term break reports a child as
 * missing school on the days the school was shut.
 *
 * ── Published only, and that is the whole authorisation rule ─────────────
 * Two guards, and both belong to the results module rather than to this file:
 * `listPublishedTermsForStudent` answers which terms the school has released,
 * and `listStudentResultHistory` is `listStudentTermHistory` with
 * `publishedOnly: true`. Nothing here reads a mark by any other route. A family
 * learning a promotion decision before the school has published it is the
 * school being told by its own software, and a promotion status is the most
 * consequential line on a report card.
 *
 * ── An exam is "next" by date, not by row order ──────────────────────────
 * `listStudentExams` already withholds unannounced and archived datesheets, so
 * a paper the school has cancelled cannot appear here and send a family in on
 * the wrong morning.
 */
export async function getChildSnapshot(
  locationId: string,
  studentProfileId: string,
  academicYearId: string | null,
  now: Date = new Date(),
): Promise<ChildSnapshot> {
  const range = monthToDate(now);
  const today = toDateOnly(now);

  const [records, terms, history, upcoming] = await Promise.all([
    listStudentAttendance(locationId, studentProfileId, range),
    listPublishedTermsForStudent(locationId, studentProfileId),
    listStudentResultHistory(locationId, studentProfileId),
    academicYearId === null
      ? Promise.resolve([])
      : listStudentExams(locationId, studentProfileId, academicYearId),
  ]);

  // `listStudentAttendance` returns newest first; a chart reads left to right.
  const chronological = [...records].reverse();
  const next = upcoming.find((exam) => exam.examDate >= today) ?? null;

  const asResult = (row: StudentTermHistoryRow): PublishedResult => ({
    termId: row.termId,
    termName: row.termName,
    academicYearName: row.academicYearName,
    gradeName: row.gradeName,
    overallPercentage: row.overallPercentage,
    overallGradeLabel: row.overallGradeLabel,
    finalStatus: row.finalStatus,
    isOverridden: row.isOverridden,
  });

  return {
    attendance: summariseAttendance(records),
    attendanceSeries: chronological
      .filter((record) => record.status !== 'holiday')
      .map((record) => (record.status === 'present' || record.status === 'late' ? 1 : 0)),
    records,
    nextExam:
      next === null
        ? null
        : { title: next.title, examDate: next.examDate, termName: next.termName },
    latestResult: history[0] === undefined ? null : asResult(history[0]),
    // Oldest first: a term-by-term line is read left to right.
    resultTrend: [...history].reverse().map(asResult),
    publishedTerms: terms.length,
  };
}

/** The section a student is currently placed in — the timetable's only input. */
export async function getStudentSectionId(
  locationId: string,
  studentProfileId: string,
  academicYearId: string,
): Promise<string | null> {
  const rows = await db
    .select({ sectionId: studentEnrollments.sectionId })
    .from(studentEnrollments)
    .where(
      and(
        eq(studentEnrollments.locationId, locationId),
        eq(studentEnrollments.studentProfileId, studentProfileId),
        eq(studentEnrollments.academicYearId, academicYearId),
        eq(studentEnrollments.status, 'active'),
      ),
    )
    .orderBy(desc(studentEnrollments.enrollmentDate))
    .limit(1);

  return rows[0]?.sectionId ?? null;
}

/** One period on a student's own day. */
export interface StudentPeriod {
  slotId: string;
  name: string;
  startTime: string;
  endTime: string;
  isBreak: boolean;
  subjectName: string;
  teacherName: string;
  room: string | null;
  isNow: boolean;
  isPast: boolean;
}

/**
 * One student's periods today.
 *
 * `listSlotsForSection`, never the unscoped `listTimetableSlots` — CLAUDE.md.
 * Which bell schedule a class runs on is decided by its grade, and the unscoped
 * call returns every structure in the school at once: an infant class laid out
 * against the senior school's eight rows, five of which can never be filled and
 * every one of which invites a click.
 *
 * Break rows are kept. A student reading their day needs to know when lunch is
 * as much as when maths is, and a list that closes the gaps up makes 11:00 look
 * like it follows 09:40.
 */
export async function getStudentDay(
  locationId: string,
  sectionId: string,
  academicYearId: string,
  now: Date = new Date(),
): Promise<StudentPeriod[]> {
  const day = weekdayIndex(now);
  if (day === null) return [];

  const [slots, entries] = await Promise.all([
    listSlotsForSection(locationId, sectionId),
    listTimetableEntries(locationId, { sectionId, academicYearId }),
  ]);

  const bySlot = new Map(
    entries.filter((entry) => entry.dayOfWeek === day).map((entry) => [entry.slotId, entry]),
  );
  const minutesNow = now.getHours() * 60 + now.getMinutes();

  return slots.map((slot) => {
    const entry = bySlot.get(slot.id);
    const start = minutesOf(slot.startTime);
    const end = minutesOf(slot.endTime);

    return {
      slotId: slot.id,
      name: slot.name,
      startTime: slot.startTime,
      endTime: slot.endTime,
      isBreak: slot.isBreak,
      subjectName: entry?.subjectName ?? '',
      teacherName: entry?.teacherName ?? '',
      room: entry?.room ?? null,
      isNow: minutesNow >= start && minutesNow < end,
      isPast: minutesNow >= end,
    };
  });
}
