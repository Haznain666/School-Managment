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

import { schoolUsers } from './school-users';
import { schools } from './schools';

export const GENDERS = ['male', 'female', 'other'] as const;
export type Gender = (typeof GENDERS)[number];

export const BLOOD_GROUPS = [
  'A+',
  'A-',
  'B+',
  'B-',
  'AB+',
  'AB-',
  'O+',
  'O-',
] as const;
export type BloodGroup = (typeof BLOOD_GROUPS)[number];

/**
 * Which identity document `b_form_cnic` holds.
 *
 * A child is admitted on a B-Form and holds a CNIC once they are eighteen, and
 * the two are indistinguishable from the number alone — a B-Form is thirteen
 * digits in the same shape. Recording only the number left the school unable to
 * say which document had been sighted, so the type is stored beside it.
 *
 * Null on every row admitted before this existed, and on any row whose number
 * is blank. It is not back-filled: guessing a document from its digits is the
 * ambiguity that made this column necessary.
 */
export const ID_DOCUMENT_TYPES = ['cnic', 'b_form'] as const;
export type IdDocumentType = (typeof ID_DOCUMENT_TYPES)[number];

export const ID_DOCUMENT_TYPE_LABELS: Record<IdDocumentType, string> = {
  cnic: 'CNIC / Smart Card',
  b_form: 'B-Form',
};

/**
 * student_profiles — the personal half of a student record.
 *
 * Exactly one row per `school_users` row of role `student`: identity, login and
 * role live there, everything a school keeps *about* the child lives here. The
 * split is what lets a student appear in the directory before their profile is
 * complete, and lets the profile survive a portal account being deactivated.
 *
 * `student_id` is the human-facing admission number (`GVS-2025-0001`, Sprint 4
 * Decision 5), unique within the school and issued by `lib/student-id.ts`.
 */
export const studentProfiles = pgTable(
  'student_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    /** 1:1 with the student's directory row. */
    schoolUserId: uuid('school_user_id')
      .notNull()
      .unique()
      .references(() => schoolUsers.id, { onDelete: 'cascade' }),
    /** School-facing admission number, e.g. `GVS-2025-0001`. */
    studentId: text('student_id').notNull(),
    dateOfBirth: date('date_of_birth'),
    gender: text('gender').$type<Gender>(),
    /** B-Form number for under-18s, CNIC once they are adults. */
    bFormCnic: text('b_form_cnic'),
    /** Which of the two `b_form_cnic` is. Null when unknown or unrecorded. */
    idDocumentType: text('id_document_type').$type<IdDocumentType>(),
    bloodGroup: text('blood_group').$type<BloodGroup>(),
    nationality: text('nationality').notNull().default('Pakistani'),
    religion: text('religion'),
    previousSchool: text('previous_school'),
    medicalNotes: text('medical_notes'),
    photoUrl: text('photo_url'),
    /** GHL contact this student is mirrored to. Null until the sync succeeds. */
    ghlContactId: text('ghl_contact_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('student_profiles_location_id_idx').on(table.locationId),
    index('student_profiles_school_user_id_idx').on(table.schoolUserId),
    // Admission numbers are unique per school, not globally.
    uniqueIndex('student_profiles_location_id_student_id_idx').on(
      table.locationId,
      table.studentId,
    ),
    check(
      'student_profiles_gender_check',
      sql`${table.gender} IS NULL OR ${table.gender} IN ('male', 'female', 'other')`,
    ),
    check(
      'student_profiles_id_document_type_check',
      sql`${table.idDocumentType} IS NULL OR ${table.idDocumentType} IN ('cnic', 'b_form')`,
    ),
    check(
      'student_profiles_blood_group_check',
      sql`${table.bloodGroup} IS NULL OR ${table.bloodGroup} IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')`,
    ),
  ],
);

export type StudentProfile = typeof studentProfiles.$inferSelect;
export type NewStudentProfile = typeof studentProfiles.$inferInsert;

export function isGender(value: unknown): value is Gender {
  return typeof value === 'string' && (GENDERS as readonly string[]).includes(value);
}

export function isIdDocumentType(value: unknown): value is IdDocumentType {
  return (
    typeof value === 'string' &&
    (ID_DOCUMENT_TYPES as readonly string[]).includes(value)
  );
}

export function isBloodGroup(value: unknown): value is BloodGroup {
  return (
    typeof value === 'string' && (BLOOD_GROUPS as readonly string[]).includes(value)
  );
}
