import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { feeTypes } from './fee-types';
import { schools } from './schools';

/**
 * concession_schemes — a discount the school owns, rather than one retyped per
 * child.
 *
 * ── What was wrong with only `student_concessions` ───────────────────────
 * A sibling discount is one decision a school made once, and it was being
 * entered as one row per child, by hand, with the name, the rate and the dates
 * typed again each time. Three consequences, all of them observed:
 *
 *   · "Sibling Discount", "Sibling discount" and "sibling disc." are the same
 *     policy and no report can tell;
 *   · the rate drifts, because the fourth child was granted 20% in a month
 *     when the school had moved to 15%;
 *   · nobody can answer "who is on the staff discount", which is the question
 *     an audit actually asks.
 *
 * A scheme is that decision, named once. Granting it to a student still writes
 * a `student_concessions` row — the grant is what prices a voucher, and it
 * **freezes the scheme's values at grant time**, exactly as a voucher line
 * freezes its price. Renaming the scheme in March must not rewrite February's
 * slip, and cutting the rate must not retroactively re-bill the children who
 * were granted the old one.
 *
 * `scheme_id` on the grant is therefore provenance, not a live join. It answers
 * "which policy is this", never "how much is it worth".
 *
 * ── Unique per school on the name ────────────────────────────────────────
 * Two schemes called "Sibling Discount" at one school is the drift this table
 * exists to end. Scoped to `location_id`, so two schools may of course each
 * have one.
 */
export const concessionSchemes = pgTable(
  'concession_schemes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    /** What the school calls it, e.g. `Sibling Discount`. */
    name: text('name').notNull(),
    discountType: text('discount_type').notNull().$type<'percentage' | 'fixed'>(),
    /** A percentage (0–100) or a flat PKR amount, per `discount_type`. */
    discountValue: numeric('discount_value', { precision: 10, scale: 2 }).notNull(),
    validFrom: date('valid_from').notNull(),
    /** Null = open ended. */
    validUntil: date('valid_until'),
    /**
     * Whether the scheme may still be granted.
     *
     * Deactivating never touches the grants already made. A school that has
     * stopped offering a discount has not taken it away from the children who
     * hold it — that is a separate decision, made per child, and one that
     * leaves the vouchers it already priced alone.
     */
    isActive: boolean('is_active').notNull().default(true),
    notes: text('notes'),
    createdByUid: text('created_by_uid'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('concession_schemes_location_id_idx').on(table.locationId),
    uniqueIndex('concession_schemes_location_name_idx').on(
      table.locationId,
      table.name,
    ),
    check(
      'concession_schemes_discount_type_check',
      sql`${table.discountType} IN ('percentage', 'fixed')`,
    ),
  ],
);

/**
 * concession_scheme_fee_types — which heads a scheme applies to.
 *
 * **No rows means every head, of every category.** That is not a convention
 * invented here: it is the existing meaning of a null
 * `student_concessions.applies_to_fee_type_id`, and STATE.md §5be records at
 * length what reading it the other way cost — an unqualified "20% sibling
 * discount", the commonest thing a school writes, silently never reached the
 * admission, annual or examination fee, and a discount that does not apply is
 * indistinguishable on screen from one the school never granted.
 *
 * So the join table is an *optional narrowing*, and an empty set is the wide
 * case rather than the empty one. `concessionPaiseFor` in
 * `lib/fee-calculator.ts` is where that is enforced, and the check script
 * asserts it.
 */
export const concessionSchemeFeeTypes = pgTable(
  'concession_scheme_fee_types',
  {
    schemeId: uuid('scheme_id')
      .notNull()
      .references(() => concessionSchemes.id, { onDelete: 'cascade' }),
    feeTypeId: uuid('fee_type_id')
      .notNull()
      .references(() => feeTypes.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.schemeId, table.feeTypeId] }),
    index('concession_scheme_fee_types_fee_type_id_idx').on(table.feeTypeId),
  ],
);

export type ConcessionScheme = typeof concessionSchemes.$inferSelect;
export type NewConcessionScheme = typeof concessionSchemes.$inferInsert;
