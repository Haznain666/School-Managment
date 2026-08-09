import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { academicYears } from './academic-years';
import { branches } from './branches';
import { schools } from './schools';
import { sections } from './sections';
import { studentEnrollments } from './student-enrollments';
import { studentProfiles } from './student-profiles';

/**
 * student_transfers — a student moved from one campus to another.
 *
 * ── Why this is a record and not just an updated enrolment ───────────────
 * A transfer is three facts a school is asked about later: when the child left
 * the old campus, when they started at the new one, and what happened to the
 * fees in between. Editing `student_enrollments.section_id` in place answers
 * none of them, and the question always comes from a parent holding a challan.
 *
 * So the enrolment is closed as `transferred` and a new one opened at the
 * receiving branch, exactly as promotion does it, and this row is the join
 * between them.
 *
 * ── Proration ───────────────────────────────────────────────────────────
 * `prorated_credit` is what the leaving branch owes back for the unused part
 * of the month already billed; `prorated_charge` is what the receiving branch
 * bills for the rest of it. They are stored as computed, not recomputed on
 * read, for the same reason a challan freezes its totals: if the school raises
 * tuition in March, a transfer settled in February must keep saying what it
 * said.
 *
 * Both may be zero — a transfer on the first of the month, or between branches
 * on the same fee structure — and that is a real answer rather than a missing
 * one, which is why they are `not null default 0` rather than nullable.
 */
export const studentTransfers = pgTable(
  'student_transfers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The tenant key — see STATE.md §1. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    studentProfileId: uuid('student_profile_id')
      .notNull()
      .references(() => studentProfiles.id, { onDelete: 'cascade' }),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYears.id),
    fromBranchId: uuid('from_branch_id')
      .notNull()
      .references(() => branches.id),
    toBranchId: uuid('to_branch_id')
      .notNull()
      .references(() => branches.id),
    fromSectionId: uuid('from_section_id')
      .notNull()
      .references(() => sections.id),
    toSectionId: uuid('to_section_id')
      .notNull()
      .references(() => sections.id),
    /** The enrolment closed by this transfer. */
    fromEnrollmentId: uuid('from_enrollment_id')
      .notNull()
      .references(() => studentEnrollments.id),
    /** The enrolment it opened. */
    toEnrollmentId: uuid('to_enrollment_id').references(() => studentEnrollments.id, {
      onDelete: 'set null',
    }),
    /** The day the student starts at the receiving branch. */
    effectiveDate: date('effective_date').notNull(),
    /** Refunded by the leaving branch for the unused part of the month. */
    proratedCredit: numeric('prorated_credit', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    /** Billed by the receiving branch for the remainder of the month. */
    proratedCharge: numeric('prorated_charge', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    reason: text('reason'),
    /** Supabase auth id of whoever recorded it. */
    transferredByUid: text('transferred_by_uid'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('student_transfers_location_id_idx').on(table.locationId),
    index('student_transfers_student_profile_id_idx').on(table.studentProfileId),
    index('student_transfers_location_effective_idx').on(
      table.locationId,
      table.effectiveDate,
    ),
    // A student cannot be transferred to the branch they are already at: that
    // is a section change, which the enrolment screen already does, and
    // allowing it here would produce a transfer record with nothing to explain.
    check(
      'student_transfers_branch_differs_check',
      sql`${table.fromBranchId} <> ${table.toBranchId}`,
    ),
  ],
);

export type StudentTransfer = typeof studentTransfers.$inferSelect;
