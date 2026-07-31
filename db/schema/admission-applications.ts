import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { academicYears } from './academic-years';
import { branches } from './branches';
import { grades } from './grades';
import { schools } from './schools';
import { studentProfiles } from './student-profiles';

export const APPLICATION_STATUSES = [
  'pending',
  'reviewing',
  'accepted',
  'rejected',
  'waitlisted',
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  pending: 'Pending',
  reviewing: 'Reviewing',
  accepted: 'Accepted',
  rejected: 'Rejected',
  waitlisted: 'Waitlisted',
};

/** Statuses that still need someone to look at them. */
export const OPEN_APPLICATION_STATUSES: readonly ApplicationStatus[] = [
  'pending',
  'reviewing',
];

/**
 * admission_applications — what the public form at `/apply` writes.
 *
 * The details are stored flat rather than as draft `student_profiles` and
 * `student_guardians` rows because an application is not a student: most will
 * never be accepted, and the ones that are get converted deliberately by an
 * admin (see `converted_to_student_profile_id`). Keeping them apart is also
 * what lets an unauthenticated endpoint write here without ever touching the
 * enrolled-student tables.
 *
 * Branch, grade and academic year are nullable: a single-campus school has no
 * branch to pick, and an applicant may not know which grade they belong in.
 */
export const admissionApplications = pgTable(
  'admission_applications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').references(() => branches.id),
    academicYearId: uuid('academic_year_id').references(() => academicYears.id),
    gradeId: uuid('grade_id').references(() => grades.id),

    studentName: text('student_name').notNull(),
    studentDob: date('student_dob'),
    studentGender: text('student_gender'),
    previousSchool: text('previous_school'),

    guardianName: text('guardian_name').notNull(),
    guardianRelationship: text('guardian_relationship').notNull(),
    /** E.164, normalised on submission — the number the school replies to. */
    guardianPhone: text('guardian_phone').notNull(),
    guardianEmail: text('guardian_email'),
    guardianCnic: text('guardian_cnic'),

    notes: text('notes'),
    status: text('status').notNull().default('pending').$type<ApplicationStatus>(),
    /** Why it was rejected or waitlisted. Required by the API on rejection. */
    statusReason: text('status_reason'),
    /** Firebase uid of the admin who last changed the status. */
    reviewedByUid: text('reviewed_by_uid'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    /** Set once the application becomes a real student. */
    convertedToStudentProfileId: uuid('converted_to_student_profile_id').references(
      () => studentProfiles.id,
    ),
    submittedAt: timestamp('submitted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('admission_applications_location_id_idx').on(table.locationId),
    index('admission_applications_location_id_status_idx').on(
      table.locationId,
      table.status,
    ),
    index('admission_applications_branch_id_idx').on(table.branchId),
    check(
      'admission_applications_status_check',
      sql`${table.status} IN ('pending', 'reviewing', 'accepted', 'rejected', 'waitlisted')`,
    ),
  ],
);

export type AdmissionApplication = typeof admissionApplications.$inferSelect;
export type NewAdmissionApplication = typeof admissionApplications.$inferInsert;

export function isApplicationStatus(value: unknown): value is ApplicationStatus {
  return (
    typeof value === 'string' &&
    (APPLICATION_STATUSES as readonly string[]).includes(value)
  );
}

/** Short reference shown to an applicant: the last 8 characters of the UUID. */
export function applicationReference(id: string): string {
  return id.slice(-8).toUpperCase();
}
