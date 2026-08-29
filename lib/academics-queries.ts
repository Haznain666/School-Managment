import 'server-only';

import { and, asc, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';

import {
  academicYears,
  attendanceRecords,
  gradeLabel,
  grades,
  periodStructureGrades,
  periodStructures,
  schoolUsers,
  sections,
  studentEnrollments,
  studentProfiles,
  subjects,
  timetableEntries,
  timetableSlots,
  type AttendanceStatus,
} from '@/db/schema';

import { minutesFromTime } from '@/db/schema/timetable-slots';

import { sharedOrOwnedBy } from './branch-scope';
import { db } from './drizzle';

/**
 * Tenant-scoped reads for the Academics module.
 *
 * Same contract as `lib/admissions-queries.ts`: every function takes
 * `locationId` first and filters on it, and that value must have come from
 * verified session claims. An id out of a request body may narrow one of these
 * reads, never widen it — which is why `locationId` is a separate argument and
 * not part of the filters object.
 */

// -----------------------------------------------------------------------------
// Subjects
// -----------------------------------------------------------------------------

export interface SubjectRow {
  id: string;
  name: string;
  code: string | null;
  color: string | null;
  isActive: boolean;
}

const SUBJECT_COLUMNS = {
  id: subjects.id,
  name: subjects.name,
  code: subjects.code,
  color: subjects.color,
  isActive: subjects.isActive,
} as const;

/**
 * The school's subjects, narrowed to a campus when the caller has one.
 *
 * `branchIds` is `sharedOrOwnedBy`'s, not `eq`'s: a subject with no campus is
 * shared by the whole school and is what every row is until somebody says
 * otherwise. Omitting it — which every caller predating Sprint 19a does — reads
 * every campus, exactly as before.
 */
export async function listSubjects(
  locationId: string,
  filters: {
    activeOnly?: boolean | undefined;
    branchIds?: string[] | null | undefined;
  } = {},
): Promise<SubjectRow[]> {
  const conditions: SQL[] = [eq(subjects.locationId, locationId)];
  if (filters.activeOnly === true) conditions.push(eq(subjects.isActive, true));

  const branchFilter = sharedOrOwnedBy(subjects.branchId, filters.branchIds ?? null);
  if (branchFilter !== undefined) conditions.push(branchFilter);

  return db
    .select(SUBJECT_COLUMNS)
    .from(subjects)
    .where(and(...conditions))
    .orderBy(asc(subjects.name));
}

export async function getSubject(
  locationId: string,
  subjectId: string,
): Promise<SubjectRow | null> {
  const rows = await db
    .select(SUBJECT_COLUMNS)
    .from(subjects)
    .where(and(eq(subjects.locationId, locationId), eq(subjects.id, subjectId)))
    .limit(1);

  return rows[0] ?? null;
}

// -----------------------------------------------------------------------------
// Period structures — the named bell schedules, and the grades on each
// -----------------------------------------------------------------------------

export interface PeriodStructureRow {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  isActive: boolean;
}

const STRUCTURE_COLUMNS = {
  id: periodStructures.id,
  name: periodStructures.name,
  description: periodStructures.description,
  isDefault: periodStructures.isDefault,
  isActive: periodStructures.isActive,
} as const;

/** Every bell schedule the school holds, the default first. */
export async function listPeriodStructures(
  locationId: string,
  filters: { activeOnly?: boolean | undefined } = {},
): Promise<PeriodStructureRow[]> {
  const conditions: SQL[] = [eq(periodStructures.locationId, locationId)];
  if (filters.activeOnly === true) {
    conditions.push(eq(periodStructures.isActive, true));
  }

  return db
    .select(STRUCTURE_COLUMNS)
    .from(periodStructures)
    .where(and(...conditions))
    .orderBy(desc(periodStructures.isDefault), asc(periodStructures.name));
}

export async function getPeriodStructure(
  locationId: string,
  structureId: string,
): Promise<PeriodStructureRow | null> {
  const rows = await db
    .select(STRUCTURE_COLUMNS)
    .from(periodStructures)
    .where(
      and(
        eq(periodStructures.locationId, locationId),
        eq(periodStructures.id, structureId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/** The school default — what a grade nobody has assigned runs on. */
export async function getDefaultPeriodStructure(
  locationId: string,
): Promise<PeriodStructureRow | null> {
  const rows = await db
    .select(STRUCTURE_COLUMNS)
    .from(periodStructures)
    .where(
      and(
        eq(periodStructures.locationId, locationId),
        eq(periodStructures.isDefault, true),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export interface StructureGradeAssignment {
  gradeId: string;
  periodStructureId: string;
}

/** Every explicit grade-to-structure assignment in the school. */
export async function listStructureGradeAssignments(
  locationId: string,
): Promise<StructureGradeAssignment[]> {
  return db
    .select({
      gradeId: periodStructureGrades.gradeId,
      periodStructureId: periodStructureGrades.periodStructureId,
    })
    .from(periodStructureGrades)
    .where(eq(periodStructureGrades.locationId, locationId));
}

/**
 * Which structure a grade runs on: its own assignment, or the school default.
 *
 * Returns null only when the school has neither — a school that has never
 * entered a bell schedule at all. Every caller that needs slots goes through
 * here rather than reading `period_structure_grades` directly, so the fallback
 * is written once and cannot be forgotten on the next screen that needs it.
 */
export async function resolveStructureForGrade(
  locationId: string,
  gradeId: string,
): Promise<PeriodStructureRow | null> {
  const assigned = await db
    .select(STRUCTURE_COLUMNS)
    .from(periodStructureGrades)
    .innerJoin(
      periodStructures,
      eq(periodStructures.id, periodStructureGrades.periodStructureId),
    )
    .where(
      and(
        eq(periodStructureGrades.locationId, locationId),
        eq(periodStructureGrades.gradeId, gradeId),
        eq(periodStructures.isActive, true),
      ),
    )
    .limit(1);

  return assigned[0] ?? (await getDefaultPeriodStructure(locationId));
}

/** The structure a section runs on, resolved through its grade. */
export async function resolveStructureForSection(
  locationId: string,
  sectionId: string,
): Promise<PeriodStructureRow | null> {
  const rows = await db
    .select({ gradeId: sections.gradeId })
    .from(sections)
    .where(and(eq(sections.locationId, locationId), eq(sections.id, sectionId)))
    .limit(1);

  const gradeId = rows[0]?.gradeId;
  if (gradeId === undefined) return null;

  return resolveStructureForGrade(locationId, gradeId);
}

// -----------------------------------------------------------------------------
// Slots — the periods inside one bell schedule
// -----------------------------------------------------------------------------

export interface SlotRow {
  id: string;
  periodStructureId: string;
  name: string;
  startTime: string;
  endTime: string;
  isBreak: boolean;
  orderIndex: number;
  isActive: boolean;
}

const SLOT_COLUMNS = {
  id: timetableSlots.id,
  periodStructureId: timetableSlots.periodStructureId,
  name: timetableSlots.name,
  startTime: timetableSlots.startTime,
  endTime: timetableSlots.endTime,
  isBreak: timetableSlots.isBreak,
  orderIndex: timetableSlots.orderIndex,
  isActive: timetableSlots.isActive,
} as const;

/**
 * Periods, ordered down the day.
 *
 * `periodStructureId` is optional, and leaving it out means "every structure in
 * the school" — which is what a summary count wants and what nothing drawing a
 * grid wants. A grid must pass one, or it lays a junior section out against the
 * senior school's eight rows.
 */
export async function listTimetableSlots(
  locationId: string,
  filters: {
    activeOnly?: boolean | undefined;
    periodStructureId?: string | undefined;
  } = {},
): Promise<SlotRow[]> {
  const conditions: SQL[] = [eq(timetableSlots.locationId, locationId)];
  if (filters.activeOnly === true) conditions.push(eq(timetableSlots.isActive, true));
  if (filters.periodStructureId !== undefined) {
    conditions.push(eq(timetableSlots.periodStructureId, filters.periodStructureId));
  }

  return db
    .select(SLOT_COLUMNS)
    .from(timetableSlots)
    .where(and(...conditions))
    .orderBy(asc(timetableSlots.orderIndex));
}

/**
 * The slots a section is laid out against — its grade's structure, or the
 * school default. Empty when the school has no bell schedule at all.
 */
export async function listSlotsForSection(
  locationId: string,
  sectionId: string,
): Promise<SlotRow[]> {
  const structure = await resolveStructureForSection(locationId, sectionId);
  if (structure === null) return [];

  return listTimetableSlots(locationId, {
    activeOnly: true,
    periodStructureId: structure.id,
  });
}

/**
 * The rows one teacher's own week should be laid out against.
 *
 * A teacher is not tied to one bell schedule. A senior-school physicist who
 * takes one junior class teaches inside two, and neither alone can draw her
 * week: the junior schedule has no eighth period and the senior one has no
 * 12:00 finish. So this returns the union of the schedules she actually teaches
 * in, ordered by the clock rather than by `order_index` — position 3 means
 * different minutes in each, and ordering by it would interleave them wrongly.
 *
 * For the ordinary case — one schedule — this is exactly the old behaviour and
 * costs one extra indexed read.
 */
export async function listSlotsForTeacher(
  locationId: string,
  teacherId: string,
  academicYearId: string,
): Promise<SlotRow[]> {
  const structureRows = await db
    .selectDistinct({ periodStructureId: timetableSlots.periodStructureId })
    .from(timetableEntries)
    .innerJoin(timetableSlots, eq(timetableSlots.id, timetableEntries.slotId))
    .where(
      and(
        eq(timetableEntries.locationId, locationId),
        eq(timetableEntries.teacherId, teacherId),
        eq(timetableEntries.academicYearId, academicYearId),
        eq(timetableEntries.isActive, true),
      ),
    );

  const structureIds = structureRows.map((row) => row.periodStructureId);
  if (structureIds.length === 0) return [];

  const slots = await db
    .select(SLOT_COLUMNS)
    .from(timetableSlots)
    .where(
      and(
        eq(timetableSlots.locationId, locationId),
        eq(timetableSlots.isActive, true),
        inArray(timetableSlots.periodStructureId, structureIds),
      ),
    );

  return slots.sort(
    (left, right) =>
      minutesFromTime(left.startTime) - minutesFromTime(right.startTime),
  );
}

export async function getTimetableSlot(
  locationId: string,
  slotId: string,
): Promise<SlotRow | null> {
  const rows = await db
    .select(SLOT_COLUMNS)
    .from(timetableSlots)
    .where(
      and(eq(timetableSlots.locationId, locationId), eq(timetableSlots.id, slotId)),
    )
    .limit(1);

  return rows[0] ?? null;
}

// -----------------------------------------------------------------------------
// Timetable
// -----------------------------------------------------------------------------

export interface TimetableEntryRow {
  id: string;
  sectionId: string;
  slotId: string;
  dayOfWeek: number;
  room: string | null;
  subjectId: string;
  subjectName: string;
  subjectCode: string | null;
  subjectColor: string | null;
  teacherId: string;
  teacherName: string;
}

/** Entries for one section's week, joined to the names the grid prints. */
export async function listTimetableEntries(
  locationId: string,
  filters: { sectionId: string; academicYearId: string },
): Promise<TimetableEntryRow[]> {
  return db
    .select({
      id: timetableEntries.id,
      sectionId: timetableEntries.sectionId,
      slotId: timetableEntries.slotId,
      dayOfWeek: timetableEntries.dayOfWeek,
      room: timetableEntries.room,
      subjectId: subjects.id,
      subjectName: subjects.name,
      subjectCode: subjects.code,
      subjectColor: subjects.color,
      teacherId: schoolUsers.id,
      teacherName: schoolUsers.name,
    })
    .from(timetableEntries)
    .innerJoin(subjects, eq(subjects.id, timetableEntries.subjectId))
    .innerJoin(schoolUsers, eq(schoolUsers.id, timetableEntries.teacherId))
    .where(
      and(
        eq(timetableEntries.locationId, locationId),
        eq(timetableEntries.sectionId, filters.sectionId),
        eq(timetableEntries.academicYearId, filters.academicYearId),
        eq(timetableEntries.isActive, true),
      ),
    )
    .orderBy(asc(timetableEntries.dayOfWeek));
}

export interface TeacherTimetableRow extends TimetableEntryRow {
  gradeName: string;
  sectionName: string;
}

/** One teacher's own week, across every section they take. */
export async function listTeacherTimetable(
  locationId: string,
  teacherId: string,
  academicYearId: string,
): Promise<TeacherTimetableRow[]> {
  const rows = await db
    .select({
      id: timetableEntries.id,
      sectionId: timetableEntries.sectionId,
      slotId: timetableEntries.slotId,
      dayOfWeek: timetableEntries.dayOfWeek,
      room: timetableEntries.room,
      subjectId: subjects.id,
      subjectName: subjects.name,
      subjectCode: subjects.code,
      subjectColor: subjects.color,
      teacherId: schoolUsers.id,
      teacherName: schoolUsers.name,
      gradeName: grades.name,
      gradeDisplayName: grades.displayName,
      sectionName: sections.name,
    })
    .from(timetableEntries)
    .innerJoin(subjects, eq(subjects.id, timetableEntries.subjectId))
    .innerJoin(schoolUsers, eq(schoolUsers.id, timetableEntries.teacherId))
    .innerJoin(sections, eq(sections.id, timetableEntries.sectionId))
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .where(
      and(
        eq(timetableEntries.locationId, locationId),
        eq(timetableEntries.teacherId, teacherId),
        eq(timetableEntries.academicYearId, academicYearId),
        eq(timetableEntries.isActive, true),
      ),
    )
    .orderBy(asc(timetableEntries.dayOfWeek));

  return rows.map(({ gradeDisplayName, ...row }) => ({
    ...row,
    gradeName: gradeLabel({ name: row.gradeName, displayName: gradeDisplayName }),
  }));
}

export interface TeacherSectionOption {
  sectionId: string;
  gradeId: string;
  label: string;
}

/**
 * The sections a teacher is timetabled into.
 *
 * This is the teacher portal's authorisation list, not a convenience: a teacher
 * may only mark the register for a class they actually teach, and this query is
 * what decides that.
 */
export async function listTeacherSections(
  locationId: string,
  teacherId: string,
  academicYearId: string,
): Promise<TeacherSectionOption[]> {
  const rows = await db
    .selectDistinct({
      sectionId: sections.id,
      gradeId: sections.gradeId,
      gradeName: grades.name,
      gradeDisplayName: grades.displayName,
      sectionName: sections.name,
    })
    .from(timetableEntries)
    .innerJoin(sections, eq(sections.id, timetableEntries.sectionId))
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .where(
      and(
        eq(timetableEntries.locationId, locationId),
        eq(timetableEntries.teacherId, teacherId),
        eq(timetableEntries.academicYearId, academicYearId),
        eq(timetableEntries.isActive, true),
      ),
    )
    .orderBy(asc(grades.name), asc(sections.name));

  return rows.map((row) => ({
    sectionId: row.sectionId,
    gradeId: row.gradeId,
    label: `${gradeLabel({ name: row.gradeName, displayName: row.gradeDisplayName })} — ${row.sectionName}`,
  }));
}

/**
 * True when this teacher is timetabled into this section.
 *
 * The attendance API calls it before letting a teacher read or mark a register:
 * a section id in a request is untrusted, and this is what stops one teacher
 * marking another's class.
 */
export async function teacherTeachesSection(
  locationId: string,
  teacherId: string,
  sectionId: string,
  academicYearId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: timetableEntries.id })
    .from(timetableEntries)
    .where(
      and(
        eq(timetableEntries.locationId, locationId),
        eq(timetableEntries.teacherId, teacherId),
        eq(timetableEntries.sectionId, sectionId),
        eq(timetableEntries.academicYearId, academicYearId),
        eq(timetableEntries.isActive, true),
      ),
    )
    .limit(1);

  return rows[0] !== undefined;
}

export interface StudentPlacement {
  studentProfileId: string;
  sectionId: string;
  sectionName: string;
  gradeName: string;
}

/**
 * Where a student sits in one year, addressed by their portal account.
 *
 * The student portal has no id in its URL — this resolves everything from the
 * uid in the session, so a student can only ever reach their own timetable.
 */
export async function getStudentPlacement(
  locationId: string,
  schoolUserId: string,
  academicYearId: string,
): Promise<StudentPlacement | null> {
  const rows = await db
    .select({
      studentProfileId: studentProfiles.id,
      sectionId: sections.id,
      sectionName: sections.name,
      gradeName: grades.name,
      gradeDisplayName: grades.displayName,
    })
    .from(studentProfiles)
    .innerJoin(
      studentEnrollments,
      eq(studentEnrollments.studentProfileId, studentProfiles.id),
    )
    .innerJoin(sections, eq(sections.id, studentEnrollments.sectionId))
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .where(
      and(
        eq(studentProfiles.locationId, locationId),
        eq(studentProfiles.schoolUserId, schoolUserId),
        eq(studentEnrollments.academicYearId, academicYearId),
        eq(studentEnrollments.status, 'active'),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (row === undefined) return null;

  return {
    studentProfileId: row.studentProfileId,
    sectionId: row.sectionId,
    sectionName: row.sectionName,
    gradeName: gradeLabel({ name: row.gradeName, displayName: row.gradeDisplayName }),
  };
}

export interface TeacherOption {
  id: string;
  name: string;
}

/** Staff who can be put in front of a class. */
export async function listTeacherOptions(
  locationId: string,
): Promise<TeacherOption[]> {
  return db
    .select({ id: schoolUsers.id, name: schoolUsers.name })
    .from(schoolUsers)
    .where(
      and(
        eq(schoolUsers.locationId, locationId),
        eq(schoolUsers.isActive, true),
        inArray(schoolUsers.role, ['teacher', 'branch_admin', 'school_admin']),
      ),
    )
    .orderBy(asc(schoolUsers.name));
}

// -----------------------------------------------------------------------------
// Attendance
// -----------------------------------------------------------------------------

export interface AttendanceStudentRow {
  enrollmentId: string;
  studentProfileId: string;
  rollNumber: string | null;
  studentName: string;
  studentId: string;
  record: {
    status: AttendanceStatus;
    notes: string | null;
  } | null;
}

/**
 * The register for one section on one day.
 *
 * Every actively enrolled student appears whether or not they have been marked;
 * `record` is null for the ones who have not. That is what lets the marking
 * screen open on a full class list rather than an empty one.
 */
export async function listSectionRegister(
  locationId: string,
  filters: { sectionId: string; academicYearId: string; date: string },
): Promise<AttendanceStudentRow[]> {
  const rows = await db
    .select({
      enrollmentId: studentEnrollments.id,
      studentProfileId: studentProfiles.id,
      rollNumber: studentEnrollments.rollNumber,
      studentName: schoolUsers.name,
      studentId: studentProfiles.studentId,
      status: attendanceRecords.status,
      notes: attendanceRecords.notes,
    })
    .from(studentEnrollments)
    .innerJoin(
      studentProfiles,
      eq(studentProfiles.id, studentEnrollments.studentProfileId),
    )
    .innerJoin(schoolUsers, eq(schoolUsers.id, studentProfiles.schoolUserId))
    .leftJoin(
      attendanceRecords,
      and(
        eq(attendanceRecords.locationId, locationId),
        eq(attendanceRecords.studentProfileId, studentEnrollments.studentProfileId),
        eq(attendanceRecords.date, filters.date),
      ),
    )
    .where(
      and(
        eq(studentEnrollments.locationId, locationId),
        eq(studentEnrollments.sectionId, filters.sectionId),
        eq(studentEnrollments.academicYearId, filters.academicYearId),
        eq(studentEnrollments.status, 'active'),
      ),
    )
    .orderBy(asc(studentEnrollments.rollNumber), asc(schoolUsers.name));

  return rows.map((row) => ({
    enrollmentId: row.enrollmentId,
    studentProfileId: row.studentProfileId,
    rollNumber: row.rollNumber,
    studentName: row.studentName,
    studentId: row.studentId,
    record: row.status === null ? null : { status: row.status, notes: row.notes },
  }));
}

export interface AttendanceReportRow {
  studentProfileId: string;
  studentName: string;
  studentId: string;
  rollNumber: string | null;
  present: number;
  absent: number;
  late: number;
  excused: number;
  holiday: number;
  total: number;
  /** Present-or-late as a share of marked, non-holiday days. */
  percentage: number;
}

/** First and last calendar day of a month, as `YYYY-MM-DD`. */
export function monthRange(month: number, year: number): { from: string; to: string } {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return {
    from: `${year}-${pad(month)}-01`,
    to: `${year}-${pad(month)}-${pad(lastDay)}`,
  };
}

const STATUS_COUNT = (status: AttendanceStatus): SQL<number> =>
  sql<number>`count(*) filter (where ${attendanceRecords.status} = ${status})`.mapWith(
    Number,
  );

/**
 * A month of attendance for one section, one row per student.
 *
 * The counts are aggregated in Postgres rather than in Node: a class of forty
 * over a month is twelve hundred rows, and pulling them back to count them
 * would make the report slower the longer a school uses the system.
 */
export async function getSectionAttendanceReport(
  locationId: string,
  filters: {
    sectionId: string;
    academicYearId: string;
    month: number;
    year: number;
  },
): Promise<AttendanceReportRow[]> {
  const { from, to } = monthRange(filters.month, filters.year);

  const rows = await db
    .select({
      studentProfileId: studentProfiles.id,
      studentName: schoolUsers.name,
      studentId: studentProfiles.studentId,
      rollNumber: studentEnrollments.rollNumber,
      present: STATUS_COUNT('present'),
      absent: STATUS_COUNT('absent'),
      late: STATUS_COUNT('late'),
      excused: STATUS_COUNT('excused'),
      holiday: STATUS_COUNT('holiday'),
    })
    .from(studentEnrollments)
    .innerJoin(
      studentProfiles,
      eq(studentProfiles.id, studentEnrollments.studentProfileId),
    )
    .innerJoin(schoolUsers, eq(schoolUsers.id, studentProfiles.schoolUserId))
    .leftJoin(
      attendanceRecords,
      and(
        eq(attendanceRecords.locationId, locationId),
        eq(attendanceRecords.studentProfileId, studentEnrollments.studentProfileId),
        gte(attendanceRecords.date, from),
        lte(attendanceRecords.date, to),
      ),
    )
    .where(
      and(
        eq(studentEnrollments.locationId, locationId),
        eq(studentEnrollments.sectionId, filters.sectionId),
        eq(studentEnrollments.academicYearId, filters.academicYearId),
        eq(studentEnrollments.status, 'active'),
      ),
    )
    .groupBy(
      studentProfiles.id,
      schoolUsers.name,
      studentProfiles.studentId,
      studentEnrollments.rollNumber,
    )
    .orderBy(asc(studentEnrollments.rollNumber), asc(schoolUsers.name));

  return rows.map((row) => {
    // A holiday is a school closure, not an absence — it is reported but kept
    // out of the denominator so it cannot drag a percentage down.
    const marked = row.present + row.absent + row.late + row.excused;
    const percentage =
      marked === 0 ? 0 : Math.round(((row.present + row.late) / marked) * 1000) / 10;

    return {
      studentProfileId: row.studentProfileId,
      studentName: row.studentName,
      studentId: row.studentId,
      rollNumber: row.rollNumber,
      present: row.present,
      absent: row.absent,
      late: row.late,
      excused: row.excused,
      holiday: row.holiday,
      total: marked + row.holiday,
      percentage,
    };
  });
}

export interface StudentAttendanceRecordRow {
  date: string;
  status: AttendanceStatus;
  notes: string | null;
}

/** One student's marks between two dates, newest first. */
export async function listStudentAttendance(
  locationId: string,
  studentProfileId: string,
  range: { from: string; to: string },
): Promise<StudentAttendanceRecordRow[]> {
  return db
    .select({
      date: attendanceRecords.date,
      status: attendanceRecords.status,
      notes: attendanceRecords.notes,
    })
    .from(attendanceRecords)
    .where(
      and(
        eq(attendanceRecords.locationId, locationId),
        eq(attendanceRecords.studentProfileId, studentProfileId),
        gte(attendanceRecords.date, range.from),
        lte(attendanceRecords.date, range.to),
      ),
    )
    .orderBy(sql`${attendanceRecords.date} desc`);
}

export interface AttendanceSummary {
  present: number;
  absent: number;
  late: number;
  excused: number;
  holiday: number;
  percentage: number;
}

/** Counts a student's own records into the four numbers a parent asks about. */
export function summariseAttendance(
  records: readonly { status: AttendanceStatus }[],
): AttendanceSummary {
  const counts = { present: 0, absent: 0, late: 0, excused: 0, holiday: 0 };

  for (const record of records) {
    counts[record.status] += 1;
  }

  const marked = counts.present + counts.absent + counts.late + counts.excused;

  return {
    ...counts,
    percentage:
      marked === 0
        ? 0
        : Math.round(((counts.present + counts.late) / marked) * 1000) / 10,
  };
}

/** Every year the school has run, newest first — for the report selectors. */
export async function listAcademicYearOptions(
  locationId: string,
): Promise<Array<{ id: string; name: string; isActive: boolean }>> {
  return db
    .select({
      id: academicYears.id,
      name: academicYears.name,
      isActive: academicYears.isActive,
    })
    .from(academicYears)
    .where(eq(academicYears.locationId, locationId))
    .orderBy(sql`${academicYears.startYear} desc, ${academicYears.startMonth} desc`);
}

/**
 * The first and last calendar day of an academic year.
 *
 * `academic_years` stores month/year pairs rather than dates, because a Pakistani
 * school's session is "April to March" or "August to July" and nobody types the
 * day (Sprint 4, Decision 2). Everything that has to *compare* a date against
 * the session — a schedule's exam day, a term's window — needs real dates, and
 * every one of them was deriving its own until Sprint 14. Deriving it twice is
 * how one screen accepts a date another refuses.
 *
 * The end is the last day of the end month, computed as "day 0 of the following
 * month", which is the one arithmetic that is right in February of a leap year
 * without a table of month lengths. Both are UTC, matching how `isIsoDate`
 * parses the values these are compared with.
 */
export function academicYearBounds(year: {
  startMonth: number;
  startYear: number;
  endMonth: number;
  endYear: number;
}): { start: string; end: string } {
  const start = new Date(Date.UTC(year.startYear, year.startMonth - 1, 1));
  // Day 0 of the month *after* the end month is the last day of the end month.
  const end = new Date(Date.UTC(year.endYear, year.endMonth, 0));

  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}
