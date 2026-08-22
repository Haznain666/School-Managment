import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { schools } from './schools';

/**
 * result_subcategories — the words a school uses instead of a mark.
 *
 * "Exceeding", "Satisfactory", "Emerging", "Needs Improvement". A primary
 * school does not tell a parent their five-year-old scored 68% in Art; it says
 * where the child is against what was expected of them. That judgement is the
 * *whole* of the result in descriptor mode — there is no mark behind it and no
 * percentage derived from it.
 *
 * ── Why the label is a row and not an enum ───────────────────────────────
 * Every school words this differently, and the wording is the product: a school
 * that says "Working Towards" will not accept "Emerging" because the platform
 * preferred it. The four seeded below are a starting point, editable and
 * deletable like any other row.
 *
 * ── Colour is stored, styling is not ─────────────────────────────────────
 * `color_hex` is the school's choice of colour and nothing else. Whether it is
 * *painted* is decided at render time by `school_exam_settings.color_coding_enabled`,
 * so switching colour coding off is retroactive by construction: every sheet
 * ever issued renders as plain text from that moment, because no row anywhere
 * carries a copy of the styling. See `lib/result-subcategories.ts`.
 *
 * ── Archive, never delete ────────────────────────────────────────────────
 * A sub-category that has been awarded to a child is part of a report card the
 * school has issued. Deleting it would empty a column on a document a parent is
 * holding. The API refuses the delete, names how many records use it, and
 * offers archive — which hides it from every picker and leaves every historical
 * sheet rendering exactly as it was issued.
 */
export const resultSubcategories = pgTable(
  'result_subcategories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The school's own id — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    /** `#22C55E`. Null = the school chose no colour for this one. */
    colorHex: text('color_hex'),
    /** Best to worst, as the school reads them. Drives every picker's order. */
    sortOrder: integer('sort_order').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('result_subcategories_location_idx').on(table.locationId),
    // Case- and space-insensitive: "Emerging" and "emerging " on one report
    // card are two chips that mean one thing, and a teacher picking between
    // them is picking at random.
    uniqueIndex('result_subcategories_location_label_idx')
      .on(table.locationId, sql`lower(btrim(${table.label}))`)
      .where(sql`archived_at IS NULL`),
    check(
      'result_subcategories_color_check',
      sql`${table.colorHex} IS NULL OR ${table.colorHex} ~ '^#[0-9A-Fa-f]{6}$'`,
    ),
    check(
      'result_subcategories_label_length_check',
      sql`char_length(btrim(${table.label})) BETWEEN 1 AND 40`,
    ),
  ],
);

export type ResultSubcategory = typeof resultSubcategories.$inferSelect;
export type NewResultSubcategory = typeof resultSubcategories.$inferInsert;

/** The longest a sub-category may be labelled. Enforced by a CHECK. */
export const SUBCATEGORY_LABEL_MAX = 40;

/** One entry of the starting set every school is seeded with. */
export interface SubcategorySeed {
  label: string;
  colorHex: string;
  sortOrder: number;
}

/**
 * What a school gets before it has opened the settings screen.
 *
 * Migration `0029` inserts these for every school that already existed, and
 * `seedResultSubcategories` in `lib/school-bootstrap.ts` gives them to every
 * school created afterwards. The two must stay the same list, for the same
 * reason `DEFAULT_CHART` and `0027`'s seed must: a school provisioned on either
 * side of the migration has to behave identically.
 *
 * Green through red, best to worst, because that is the order a teacher reads a
 * picker in and the order a parent reads a legend in.
 */
export const DEFAULT_SUBCATEGORIES: readonly SubcategorySeed[] = [
  { label: 'Exceeding', colorHex: '#22C55E', sortOrder: 0 },
  { label: 'Satisfactory', colorHex: '#3B82F6', sortOrder: 1 },
  { label: 'Emerging', colorHex: '#F59E0B', sortOrder: 2 },
  { label: 'Needs Improvement', colorHex: '#EF4444', sortOrder: 3 },
];
