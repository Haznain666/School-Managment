import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { branches } from './branches';
import { schoolUsers } from './school-users';
import { schools } from './schools';

/**
 * branch_leave_settings — decision 8, and it is one setting.
 *
 * ── The question it answers ─────────────────────────────────────────────
 * A teacher applies for the 12th to the 16th. The 14th is Independence Day.
 * Does she spend five days of her entitlement or four?
 *
 * Both answers are defensible and schools genuinely differ, so the product
 * owner made it **HR's setting, per campus**, applying to everybody at that
 * campus:
 *
 *   · `include` — the holiday counts. Five days. The default, because it is
 *     what the product did before this table existed and what decision 11 says
 *     in so many words: *"a range touching a holiday is accepted, and the
 *     holiday counts"*.
 *   · `skip` — the holiday is not deducted. Four days.
 *
 * ── Why a table and not a column on `branches` ──────────────────────────
 * The same reasoning `staff_kpi_settings` records: `branches` is read on
 * practically every request, and `lib/principal-resolver.ts` documents what a
 * new column on a hot table costs in the window between a deploy and its
 * migration. A school with no row here behaves exactly as it did yesterday.
 *
 * `branch_id` null is the school's own default, used by every campus that has
 * not set its own. Two partial unique indexes, for the reason `holidays`
 * states: Postgres counts every NULL as distinct.
 */

export const HOLIDAY_SPANS = ['include', 'skip'] as const;
export type HolidaySpan = (typeof HOLIDAY_SPANS)[number];

export const HOLIDAY_SPAN_LABELS: Record<HolidaySpan, string> = {
  include: 'Count the holiday as leave',
  skip: 'Do not count the holiday',
};

/** What a school gets before HR touches anything. */
export const DEFAULT_HOLIDAY_SPAN: HolidaySpan = 'include';

export const branchLeaveSettings = pgTable(
  'branch_leave_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    /** The campus, or null for the school's own default. */
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'cascade' }),
    holidaySpan: text('holiday_span').notNull().default('include').$type<HolidaySpan>(),
    updatedBy: uuid('updated_by').references(() => schoolUsers.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('branch_leave_settings_location_id_idx').on(table.locationId),
    uniqueIndex('branch_leave_settings_school_wide_idx')
      .on(table.locationId)
      .where(sql`${table.branchId} IS NULL`),
    uniqueIndex('branch_leave_settings_branch_idx')
      .on(table.locationId, table.branchId)
      .where(sql`${table.branchId} IS NOT NULL`),
    check(
      'branch_leave_settings_holiday_span_check',
      sql`${table.holidaySpan} IN ('include', 'skip')`,
    ),
  ],
);

export type BranchLeaveSetting = typeof branchLeaveSettings.$inferSelect;
export type NewBranchLeaveSetting = typeof branchLeaveSettings.$inferInsert;

export function isHolidaySpan(value: unknown): value is HolidaySpan {
  return typeof value === 'string' && (HOLIDAY_SPANS as readonly string[]).includes(value);
}
