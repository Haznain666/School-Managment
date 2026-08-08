import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { schools } from './schools';

/**
 * grading_schemes + grading_bands — how a percentage becomes a letter.
 *
 * Two tables in one file because they are one concept: a scheme with no bands
 * grades nothing, and a band belongs to exactly one scheme. Splitting them
 * would file half of a rule in each of two places.
 *
 * ── Why this is data and not code ────────────────────────────────────────
 * Every school in this market grades differently. A Matric school runs A1/A/B
 * from 80/70/60; an O-Level school runs A-star, A and B on a different ladder; a
 * primary school may want "Excellent / Good / Needs work" and no GPA at all.
 * A hard-coded table would be wrong for all three, and the first school that
 * asked for its own would need a deploy. `lib/grading.ts` holds the resolution
 * rule; the bands themselves are the school's.
 *
 * ── Bands are half-open at the top, closed at the bottom ─────────────────
 * `min_percentage <= score <= max_percentage`, and the resolver takes the
 * *highest* matching band. Schools write their bands as "80–89, 70–79", which
 * leaves 89.5 in no band at all if the comparison is literal — so the resolver
 * treats the top band's ceiling as open-ended and the gaps between bands as
 * belonging to the lower one. That behaviour is in `lib/grading.ts` and tested
 * by the way a school will actually enter its bands, not by a schema rule.
 */
export const gradingSchemes = pgTable(
  'grading_schemes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The school's own id — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /**
     * The scheme a term falls back to when it names none.
     *
     * Enforced on write rather than by a partial unique index, for the same
     * reason `academic_years.is_active` is: making a scheme the default has to
     * demote the incumbent, and a constraint would reject that instead of
     * resolving it.
     */
    isDefault: boolean('is_default').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('grading_schemes_location_id_idx').on(table.locationId),
    uniqueIndex('grading_schemes_location_id_name_idx').on(table.locationId, table.name),
  ],
);

export const gradingBands = pgTable(
  'grading_bands',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The school's own id — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    schemeId: uuid('scheme_id')
      .notNull()
      .references(() => gradingSchemes.id, { onDelete: 'cascade' }),
    /** `A+`, `B`, `Excellent`. Whatever the school prints. */
    label: text('label').notNull(),
    minPercentage: numeric('min_percentage', { precision: 5, scale: 2 }).notNull(),
    maxPercentage: numeric('max_percentage', { precision: 5, scale: 2 }).notNull(),
    /** Null for a school that grades in letters and does not compute a GPA. */
    gpa: numeric('gpa', { precision: 4, scale: 2 }),
    /** Printed under the grade on a report card, e.g. "Outstanding". */
    remark: text('remark'),
    /** Highest band first, so the resolver can stop at the first match. */
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('grading_bands_location_id_idx').on(table.locationId),
    index('grading_bands_scheme_id_idx').on(table.schemeId),
    uniqueIndex('grading_bands_scheme_id_label_idx').on(table.schemeId, table.label),
    check(
      'grading_bands_range_check',
      sql`${table.minPercentage} >= 0 AND ${table.maxPercentage} <= 100 AND ${table.minPercentage} <= ${table.maxPercentage}`,
    ),
  ],
);

export type GradingScheme = typeof gradingSchemes.$inferSelect;
export type NewGradingScheme = typeof gradingSchemes.$inferInsert;
export type GradingBand = typeof gradingBands.$inferSelect;
export type NewGradingBand = typeof gradingBands.$inferInsert;
