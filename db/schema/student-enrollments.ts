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
 * Whether the admission fee on this enrollment has been settled.
 *
 * ── Why this is a second column and not a fifth status ───────────────────
 * "A student is only enrolled once their fee is paid" is a real rule, and the
 * obvious way to write it is `status = 'pending_fee'`. That would be wrong
 * here, and expensively so: `status = 'active'` is what the register, the
 * promotion run, the class lists, the challan generator and nine reports all
 * filter on. A child admitted on Monday and paying on Friday would be invisible
 * to every one of them for four days — no register to mark, no challan to pay,
 * and therefore no way to ever leave the state.
 *
 * The enrollment is real from the moment it is written. What is conditional is
 * whether it has been *confirmed*, and that is what this records.
 */
export const FEE_CLEARANCE_STATUSES = ['outstanding', 'cleared'] as const;
export type FeeClearanceStatus = (typeof FEE_CLEARANCE_STATUSES)[number];

export const FEE_CLEARANCE_LABELS: Record<FeeClearanceStatus, string> = {
  outstanding: 'Fee outstanding',
  cleared: 'Enrolled — fee paid',
};

export function isFeeClearanceStatus(value: unknown): value is FeeClearanceStatus {
  return (
    typeof value === 'string' &&
    (FEE_CLEARANCE_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * student_enrollments — one row per student per academic year.
 *
 * This is the history table: promoting a child to the next class adds a row
 * rather than editing the old one, so "which section was she in two years ago"
 * stays answerable. The unique key enforces the other half of that rule — a
 * student cannot hold two enrollments in the same year.
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
    /**
     * `outstanding` until the school has been paid, then `cleared`.
     *
     * Defaults to `outstanding`, so a newly admitted child starts unconfirmed
     * and the guardians' portal welcome is held back until the money is in.
     * Every enrollment that existed before this column was added was back-filled
     * to `cleared` — those children are already at school, and re-opening a
     * settled admission to chase a fee that was paid last year would be a
     * fabricated debt.
     */
    feeStatus: text('fee_status')
      .notNull()
      .default('outstanding')
      .$type<FeeClearanceStatus>(),
    /** When the fee cleared. Null while it is outstanding. */
    feeClearedAt: timestamp('fee_cleared_at', { withTimezone: true }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('student_enrollments_location_id_idx').on(table.locationId),
    index('student_enrollments_section_id_idx').on(table.sectionId),
    index('student_enrollments_academic_year_id_idx').on(table.academicYearId),
    /*
     * One **active** enrollment per student per year — not one enrollment.
     *
     * The unqualified form was right until students could move between
     * campuses mid-year. A transfer closes the enrollment at the old campus and
     * opens one at the new, both inside the same academic year, and the
     * unqualified index forbade the second row outright.
     *
     * Editing the first row in place was the obvious alternative and is wrong:
     * `attendance_records.enrollment_id` points at it, so a register taken at
     * the old campus in July would afterwards claim to have been taken at the
     * new one. The child really did have two placements that year, and both
     * have to exist for the terms they cover to stay attributable.
     *
     * The invariant that actually matters is untouched: a student is in
     * exactly one class at a time. Partial, so closed rows — `transferred`,
     * `withdrawn`, `graduated` — accumulate freely.
     */
    uniqueIndex('student_enrollments_location_id_profile_year_idx')
      .on(table.locationId, table.studentProfileId, table.academicYearId)
      .where(sql`${table.status} = 'active'`),
    // The list screens filter on this, and the fee gate scans it for the
    // enrollments still waiting on money.
    index('student_enrollments_location_fee_status_idx').on(
      table.locationId,
      table.feeStatus,
    ),
    check(
      'student_enrollments_status_check',
      sql`${table.status} IN ('active', 'transferred', 'withdrawn', 'graduated')`,
    ),
    check(
      'student_enrollments_fee_status_check',
      sql`${table.feeStatus} IN ('outstanding', 'cleared')`,
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
