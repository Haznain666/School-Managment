import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { branches } from './branches';
import { schoolUsers } from './school-users';
import { schools } from './schools';

/**
 * section_head_coordinators — which coordinators a section head runs.
 *
 * Sprint 33b. Migration `0047`. The second rung of the chain of command, and
 * deliberately the **same shape** as Sprint 32's `coordinator_teachers`: a pair
 * of user ids, the campus they share, and who made the link.
 *
 * ── Why the coordinator → teacher table is reused, not rebuilt ───────────
 * `coordinator_teachers` already answers "which teachers does this coordinator
 * supervise", and the KPI module reads it on every rating. A second table
 * saying the same thing for leave would be two answers to one question, and the
 * first time they disagreed a teacher would be rated by one person and approved
 * by another with nothing to say which was right. So the chain is: this table
 * for the rung above, `coordinator_teachers` unchanged for the rung below.
 *
 * ── One-to-many, per campus ─────────────────────────────────────────────
 * A section head runs several coordinators; a coordinator reports to one. The
 * unique index is on the **pair**, not on the coordinator, and that is not an
 * oversight — a school in the middle of a reorganisation may briefly name two,
 * and `lib/approval-chain.ts` treats "more than one" the way it treats a
 * teacher under several coordinators: it skips the level and routes upward.
 * Refusing the second row would refuse the reorganisation instead.
 *
 * `branch_id` is NOT NULL: a reporting line belongs to a campus. A person with
 * no campus of their own belongs to the school, and the school's answer is the
 * Principal — which the chain reaches without a row here.
 */
export const sectionHeadCoordinators = pgTable(
  'section_head_coordinators',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    sectionHeadUserId: uuid('section_head_user_id')
      .notNull()
      .references(() => schoolUsers.id, { onDelete: 'cascade' }),
    coordinatorUserId: uuid('coordinator_user_id')
      .notNull()
      .references(() => schoolUsers.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    assignedBy: uuid('assigned_by').references(() => schoolUsers.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('section_head_coordinators_pair_idx').on(
      table.sectionHeadUserId,
      table.coordinatorUserId,
    ),
    // The chain's own read: "who is above this coordinator", tenant first.
    index('section_head_coordinators_location_coordinator_idx').on(
      table.locationId,
      table.coordinatorUserId,
    ),
    check(
      'section_head_coordinators_distinct_check',
      sql`${table.sectionHeadUserId} <> ${table.coordinatorUserId}`,
    ),
  ],
);

export type SectionHeadCoordinator = typeof sectionHeadCoordinators.$inferSelect;
export type NewSectionHeadCoordinator = typeof sectionHeadCoordinators.$inferInsert;
