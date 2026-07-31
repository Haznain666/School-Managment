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
import { schools } from './schools';
import { sections } from './sections';
import { studentProfiles } from './student-profiles';

export const ENROLLMENT_STATUSES = [
  'active',
  'transferred',
  'withdrawn',
  'graduated',
] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

export const ENROLLMENT_STATUS_LABELS: Record<EnrollmentStatus, string> = {
  active: 'Active',
  transferred: 'Transferred',
  withdrawn: 'Withdrawn',
  graduated: 'Graduated',
};

/**
 * student_enrollments — one row per student per academic year.
 *
 * This is the history table: promoting a child to the next class adds a row
 * rather than editing the old one, so "which section was she in two years ago"
 * stays answerable. The unique key enforces the other half of that rule — a
 * student cannot hold two enrolments in the same year.
 *
 * `section_id` and `academic_year_id` deliberately do not cascade: deleting a
 * year or a section that has students must fail loudly, and the API turns that
 * into a 409 before the constraint ever fires.
 */
export const studentEnrollments = pgTable(
  'student_enrollments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    studentProfileId: uuid('student_profile_id')
      .notNull()
      .references(() => studentProfiles.id, { onDelete: 'cascade' }),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => sections.id),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYears.id),
    /** Position within the section. Optional — not every school uses them. */
    rollNumber: text('roll_number'),
    enrollmentDate: date('enrollment_date').notNull().defaultNow(),
    status: text('status').notNull().default('active').$type<EnrollmentStatus>(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('student_enrollments_location_id_idx').on(table.locationId),
    index('student_enrollments_section_id_idx').on(table.sectionId),
    index('student_enrollments_academic_year_id_idx').on(table.academicYearId),
    uniqueIndex('student_enrollments_location_id_profile_year_idx').on(
      table.locationId,
      table.studentProfileId,
      table.academicYearId,
    ),
    check(
      'student_enrollments_status_check',
      sql`${table.status} IN ('active', 'transferred', 'withdrawn', 'graduated')`,
    ),
  ],
);

export type StudentEnrollment = typeof studentEnrollments.$inferSelect;
export type NewStudentEnrollment = typeof studentEnrollments.$inferInsert;

export function isEnrollmentStatus(value: unknown): value is EnrollmentStatus {
  return (
    typeof value === 'string' &&
    (ENROLLMENT_STATUSES as readonly string[]).includes(value)
  );
}
