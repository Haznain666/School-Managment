import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { academicYears } from './academic-years';
import { branches } from './branches';
import { schools } from './schools';

/**
 * academic_year_branches — which campuses run a session.
 *
 * ── A year with no rows is school-wide ───────────────────────────────────
 * That is every academic year that exists today, at every school, and it is
 * what makes this table safe to add: absence means "all of them", so nothing
 * has to be backfilled and no existing year changes meaning on the day the
 * migration lands. It is the same shape as decision D1's nullable `branch_id`
 * on the nine catalogue tables — *null means shared* — expressed as a join
 * table because a year can run at two campuses out of three, which one column
 * cannot say.
 *
 * Read it through `sharedOrRunAtBranches` in `lib/admissions-queries.ts`, never
 * with a bare join: an INNER JOIN here silently drops every school-wide year,
 * and an empty academic-year list reads as a school that was never set up
 * rather than as a filter that is wrong. That is precisely the failure
 * `sharedOrOwnedBy` exists to prevent one module over, and it costs a school
 * its whole calendar rather than one subject list.
 *
 * ── Why a campus at all ──────────────────────────────────────────────────
 * A group whose Karachi campus runs April–March and whose Lahore campus runs
 * August–July has two calendars, not one, and before this the Admissions
 * screens offered every campus's years to every campus's clerk with nothing to
 * tell them apart. Enrolling a Lahore child into the Karachi session is not an
 * error any constraint can catch — both rows are valid — and it surfaces months
 * later as a report card printed against the wrong term window.
 *
 * ── ON DELETE CASCADE on both parents, and that is not the D1 rule ───────
 * A catalogue row whose campus is deleted becomes *shared* (SET NULL), because
 * a grading scheme outliving its campus is still the school's. A row here says
 * only "this year runs at this campus"; when the campus is gone the statement
 * is not school-wide, it is meaningless, and keeping it would silently widen
 * the year to every remaining campus. Deleting the row leaves the year
 * school-wide anyway if it was the last one — which is the same safe direction,
 * reached by saying nothing rather than by saying something false.
 *
 * `location_id` is carried and indexed even though it is reachable through
 * either parent: every read in this repository is tenant-first, and a join
 * table that cannot be filtered by tenant without two joins is a join table
 * every query pays for.
 */
export const academicYearBranches = pgTable(
  'academic_year_branches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The school's own id — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYears.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Saying the same thing twice is not saying it twice. The run writer leans
    // on this: re-running a run that was interrupted half way must not bank a
    // second row for a campus it already attached.
    uniqueIndex('academic_year_branches_year_branch_idx').on(
      table.academicYearId,
      table.branchId,
    ),
    index('academic_year_branches_location_year_idx').on(
      table.locationId,
      table.academicYearId,
    ),
    index('academic_year_branches_location_branch_idx').on(
      table.locationId,
      table.branchId,
    ),
  ],
);

export type AcademicYearBranch = typeof academicYearBranches.$inferSelect;
export type NewAcademicYearBranch = typeof academicYearBranches.$inferInsert;
