import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { academicYears } from './academic-years';
import { schoolUsers } from './school-users';
import { schools } from './schools';
import { studentEnrollments } from './student-enrollments';
import { studentProfiles } from './student-profiles';

export const ATTENDANCE_STATUSES = [
  'present',
  'absent',
  'late',
  'excused',
  'holiday',
] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: 'Present',
  absent: 'Absent',
  late: 'Late',
  excused: 'Excused',
  holiday: 'Holiday',
};

/** Single letters for the marking toggles, where a full word will not fit. */
export const ATTENDANCE_STATUS_INITIALS: Record<AttendanceStatus, string> = {
  present: 'P',
  absent: 'A',
  late: 'L',
  excused: 'E',
  holiday: 'H',
};

/**
 * attendance_records — one row per student per day.
 *
 * Attendance is daily rather than per period: that is what Pakistani schools
 * report to their boards and what a parent asks about, and a per-period register
 * would multiply the marking work by seven for a number nobody uses.
 *
 * The unique key on (location, date, student) is what makes marking idempotent.
 * A teacher who saves the register twice, or corrects it an hour later, updates
 * the same row — so a day can never hold two contradictory answers for one
 * child, and the API upserts onto it rather than checking first.
 *
 * `marked_by` is kept for the same reason schools keep a signature on the paper
 * register: an absence disputed by a parent has to be answerable.
 */
export const attendanceRecords = pgTable(
  'attendance_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYears.id),
    date: date('date').notNull(),
    studentProfileId: uuid('student_profile_id')
      .notNull()
      .references(() => studentProfiles.id, { onDelete: 'cascade' }),
    /** The placement this mark was taken against — the section is read from it. */
    enrollmentId: uuid('enrollment_id')
      .notNull()
      .references(() => studentEnrollments.id),
    status: text('status').notNull().$type<AttendanceStatus>(),
    /** Who took the register. Null when their account has since been removed. */
    markedBy: uuid('marked_by').references(() => schoolUsers.id, {
      onDelete: 'set null',
    }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('attendance_records_location_id_date_idx').on(table.locationId, table.date),
    index('attendance_records_location_id_student_idx').on(
      table.locationId,
      table.studentProfileId,
    ),
    uniqueIndex('attendance_records_location_date_student_idx').on(
      table.locationId,
      table.date,
      table.studentProfileId,
    ),
    check(
      'attendance_records_status_check',
      sql`${table.status} IN ('present', 'absent', 'late', 'excused', 'holiday')`,
    ),
  ],
);

export type AttendanceRecord = typeof attendanceRecords.$inferSelect;
export type NewAttendanceRecord = typeof attendanceRecords.$inferInsert;

export function isAttendanceStatus(value: unknown): value is AttendanceStatus {
  return (
    typeof value === 'string' && (ATTENDANCE_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * The share of marked days a student was present for, 0–100.
 *
 * `late` counts as present — the child was in class — and `holiday` is excluded
 * from the denominator entirely, because a school closure is not an absence and
 * must not drag a percentage down.
 */
export function attendancePercentage(counts: {
  present: number;
  absent: number;
  late: number;
  excused: number;
}): number {
  const marked = counts.present + counts.absent + counts.late + counts.excused;
  if (marked === 0) return 0;

  return Math.round(((counts.present + counts.late) / marked) * 1000) / 10;
}
