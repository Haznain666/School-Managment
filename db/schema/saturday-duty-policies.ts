import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { USER_ROLES } from '@/types/school-auth';

import { schools } from './schools';

/**
 * saturday_duty_policies — which Saturdays a role is called in on.
 *
 * ── The requirement this exists for, stated exactly ──────────────────────
 * *"Teachers and coordinators are called every Saturday, while the principal
 * comes in on 2. Four coordinators each come on one distinct Saturday."*
 *
 * Both halves of that are load-bearing. It is per **role** — teachers, all of
 * them, every Saturday — and it is per **person** — four named coordinators,
 * one Saturday each, and not the same one. So there are two levels, and this
 * table is the first: the school's default for a role.
 * `staff.saturday_ordinals` is the second, and it overrides this one.
 *
 * ── Ordinals, not a count ────────────────────────────────────────────────
 * `{1, 3}` means *the first and third Saturday of the month*, not *two of
 * them*. A count cannot express what the requirement actually says — four
 * coordinators on four **distinct** Saturdays — and it cannot answer the only
 * question a calendar ever asks, which is whether **this** Saturday is a
 * working day for **this** person.
 *
 * The empty array is a real answer and the common one: a role that is never
 * called in on a Saturday. It is not the same as having no row, which means the
 * school has not decided — and both resolve to "no Saturdays" today, because
 * that is the safe default for a policy nobody has set.
 *
 * ── Why 1..5 and not 1..4 ────────────────────────────────────────────────
 * A month can hold five Saturdays. `saturdayOrdinal` in
 * `lib/holiday-calendar.ts` returns 5 for those, and a policy that could not
 * name it would silently make every fifth Saturday a day off for everybody —
 * eight or nine days a year, invisibly.
 */
export const saturdayDutyPolicies = pgTable(
  'saturday_duty_policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The tenant key — see STATE.md §1. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    /** A `USER_ROLES` value. Checked against the same list the code holds. */
    role: text('role').notNull(),
    /** Subset of 1–5. `{}` means this role is never called in on a Saturday. */
    ordinals: integer('ordinals').array().notNull().default(sql`'{}'::integer[]`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('saturday_duty_policies_location_role_idx').on(
      table.locationId,
      table.role,
    ),
    check(
      'saturday_duty_policies_role_check',
      sql.raw(`role IN (${USER_ROLES.map((role) => `'${role}'`).join(', ')})`),
    ),
  ],
);

export type SaturdayDutyPolicy = typeof saturdayDutyPolicies.$inferSelect;
export type NewSaturdayDutyPolicy = typeof saturdayDutyPolicies.$inferInsert;
