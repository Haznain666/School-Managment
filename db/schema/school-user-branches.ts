import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { branches } from './branches';
import { schools } from './schools';
import { schoolUsers } from './school-users';

/**
 * school_user_branches — the campuses a person may see *in addition* to their
 * own.
 *
 * ── Why this is a table and not a permission (Sprint 19a, decision D2) ────
 * A school group asked for "let the Karachi principal also see Hyderabad".
 * Expressed as a permission key that would be a grant to *every* principal at
 * the school at once, which is the opposite of what was asked and could not be
 * undone for one person without taking it from all of them. Cross-branch access
 * is a fact about a person, so it is stored per person.
 *
 * ── It widens, it never narrows ──────────────────────────────────────────
 * `resolveBranchScope` unions these rows onto `school_users.branch_id`. A
 * member with no rows here reaches exactly one campus, which is what every
 * branch-bound member is today — so an empty table behaves as the product
 * behaved before this existed, at every school, on the day it deploys.
 *
 * Nothing here widens a *tenant*: `location_id` is carried and filtered like
 * every other table in this schema, and the branch a row names still has to be
 * a branch of the same school. Supabase RLS is a second line, not the first.
 *
 * ── `granted_by_uid` ─────────────────────────────────────────────────────
 * "Who gave this principal the Karachi campus" is a question a school group
 * gets asked, usually months later and usually because something went wrong.
 * The grant may be revoked by then; the row is deleted with it, so this is not
 * a full audit trail — but while the grant stands it is the only record of who
 * made it, and a column that answers with silence is worse than one nobody
 * reads.
 */
export const schoolUserBranches = pgTable(
  'school_user_branches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    schoolUserId: uuid('school_user_id')
      .notNull()
      .references(() => schoolUsers.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    /** The `auth.users.id` of whoever granted it. Null for a seeded row. */
    grantedByUid: text('granted_by_uid'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The resolver's own lookup: one person, every campus granted to them.
    index('school_user_branches_location_user_idx').on(
      table.locationId,
      table.schoolUserId,
    ),
    index('school_user_branches_branch_id_idx').on(table.branchId),
    // Granting the same campus twice is not a second grant. Without this the
    // branch form's "the school owner" path would write a duplicate every time
    // somebody re-saved the campus, and revoking would then take two deletes.
    uniqueIndex('school_user_branches_user_branch_idx').on(
      table.schoolUserId,
      table.branchId,
    ),
  ],
);

export type SchoolUserBranch = typeof schoolUserBranches.$inferSelect;
export type NewSchoolUserBranch = typeof schoolUserBranches.$inferInsert;
