import 'server-only';

import { and, asc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';

import {
  academicYears,
  attendanceRecords,
  gradeLabel,
  grades,
  schoolUsers,
  sections,
  studentEnrollments,
  studentProfiles,
  subjects,
  timetableEntries,
  timetableSlots,
  type AttendanceStatus,
} from '@/db/schema';

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

export async function listSubjects(
  locationId: string,
  filters: { activeOnly?: boolean | undefined } = {},
): Promise<SubjectRow[]> {
  const conditions: SQL[] = [eq(subjects.locationId, locationId)];
  if (filters.activeOnly === true) conditions.push(eq(subjects.isActive, true));

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
// Slots — the bell schedule
// -----------------------------------------------------------------------------

export interface SlotRow {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  isBreak: boolean;
  orderIndex: number;
  isActive: boolean;
}

const SLOT_COLUMNS = {
  id: timetableSlots.id,
  name: timetableSlots.name,
  startTime: timetableSlots.startTime,
  endTime: timetableSlots.endTime,
  isBreak: timetableSlots.isBreak,
  orderIndex: timetableSlots.orderIndex,
  isActive: timetableSlots.isActive,
} as const;

export async function listTimetableSlots(
  locationId: string,
  filters: { activeOnly?: boolean | undefined } = {},
): Promise<SlotRow[]> {
  const conditions: SQL[] = [eq(timetableSlots.locationId, locationId)];
  if (filters.activeOnly === true) conditions.push(eq(timetableSlots.isActive, true));

  return db
    .select(SLOT_COLUMNS)
    .from(timetableSlots)
    .where(and(...conditions))
    .orderBy(asc(timetableSlots.orderIndex));
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
