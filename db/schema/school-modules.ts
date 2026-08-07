import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { SCHOOL_FLAG_KEYS } from '@/lib/platform-modules';

import { schools } from './schools';

/**
 * school_modules — which platform modules and delivery channels a school has
 * switched on.
 *
 * One row per (school, flag). A flag with no row is treated as disabled, so
 * provisioning a school does not require seeding ten rows up front.
 *
 * The valid keys live in `lib/platform-modules.ts` and are mirrored into a
 * CHECK constraint here, so a typo cannot silently create a flag that no part
 * of the application knows about.
 *
 * The table kept its name when channels joined it. Renaming it to
 * `school_flags` would have been more accurate and would have touched every
 * query, migration and snapshot that mentions it, to buy a better noun; the
 * key lists in `lib/platform-modules.ts` say which is which.
 */
export const schoolModules = pgTable(
  'school_modules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    moduleKey: text('module_key').notNull(),
    isEnabled: boolean('is_enabled').notNull().default(false),
    /** When it was last switched on. Null while disabled. */
    enabledAt: timestamp('enabled_at', { withTimezone: true }),
    /** Super Admin email that made the change — an audit breadcrumb. */
    enabledBy: text('enabled_by'),
  },
  (table) => [
    index('school_modules_location_id_idx').on(table.locationId),
    uniqueIndex('school_modules_location_id_module_key_idx').on(
      table.locationId,
      table.moduleKey,
    ),
    check(
      'school_modules_module_key_check',
      sql.raw(
        `module_key IN (${SCHOOL_FLAG_KEYS.map((key) => `'${key}'`).join(', ')})`,
      ),
    ),
  ],
);

export type SchoolModuleRow = typeof schoolModules.$inferSelect;
export type NewSchoolModuleRow = typeof schoolModules.$inferInsert;
