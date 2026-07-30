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

import { branches } from './branches';
import { schools } from './schools';
import { users } from './users';

export const STUDENT_STATUSES = [
  'enrolled',
  'graduated',
  'withdrawn',
  'suspended',
] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];

/**
 * students — minimal Sprint 1 shape. Academic records (attendance, grades,
 * fees) arrive in later sprints; this exists so the tenant-scoped API route
 * has something real to read.
 */
export const students = pgTable(
  'students',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').references(() => branches.id, {
      onDelete: 'set null',
    }),
    /** Set once the student has a portal login; NULL until then. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** School-assigned roll number. Unique within a school. */
    admissionNumber: text('admission_number').notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    dateOfBirth: date('date_of_birth'),
    gender: text('gender'),
    /** e.g. "Grade 6", "O2" — free text in Sprint 1. */
    className: text('class_name'),
    section: text('section'),
    guardianName: text('guardian_name'),
    guardianPhone: text('guardian_phone'),
    /** GHL contact this student is mirrored to, if synced. */
    ghlContactId: text('ghl_contact_id'),
    status: text('status').notNull().default('enrolled').$type<StudentStatus>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('students_location_id_idx').on(table.locationId),
    index('students_location_id_branch_id_idx').on(
      table.locationId,
      table.branchId,
    ),
    uniqueIndex('students_location_id_admission_number_idx').on(
      table.locationId,
      table.admissionNumber,
    ),
    check(
      'students_status_check',
      sql`${table.status} IN ('enrolled', 'graduated', 'withdrawn', 'suspended')`,
    ),
  ],
);

export type Student = typeof students.$inferSelect;
export type NewStudent = typeof students.$inferInsert;
