import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { schoolSubdomains } from './school-subdomains';

/**
 * Pakistani schools commonly split their upper years into separate academic
 * tracks. A branch belongs to exactly one of them (or none).
 */
export const SECONDARY_PATHS = ['matric', 'o-level', 'a-level'] as const;
export type SecondaryPath = (typeof SECONDARY_PATHS)[number];

export const BRANCH_STATUSES = ['active', 'inactive'] as const;
export type BranchStatus = (typeof BRANCH_STATUSES)[number];

/**
 * branches — physical campuses belonging to one school (location_id).
 *
 * Staff may be scoped to a single branch via `user_roles.branch_id`;
 * a NULL branch_id there means "all branches of this school".
 */
export const branches = pgTable(
  'branches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: text('location_id')
      .notNull()
      .references(() => schoolSubdomains.locationId, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    city: text('city').notNull(),
    secondaryPath: text('secondary_path').$type<SecondaryPath>(),
    address: text('address'),
    phone: text('phone'),
    /** ID of the mirrored record in GHL's custom objects, if synced. */
    ghlCustomObjectId: text('ghl_custom_object_id'),
    status: text('status').notNull().default('active').$type<BranchStatus>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('branches_location_id_idx').on(table.locationId),
    index('branches_location_id_status_idx').on(table.locationId, table.status),
    check(
      'branches_secondary_path_check',
      sql`${table.secondaryPath} IS NULL OR ${table.secondaryPath} IN ('matric', 'o-level', 'a-level')`,
    ),
  ],
);

export type Branch = typeof branches.$inferSelect;
export type NewBranch = typeof branches.$inferInsert;
