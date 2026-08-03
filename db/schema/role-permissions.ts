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

import { PERMISSIONS } from '@/lib/permissions';
import { USER_ROLES } from '@/types/school-auth';

import { schoolUsers } from './school-users';
import { schools } from './schools';

/**
 * role_permissions — a school's departures from the default access model.
 *
 * ── Why this table holds overrides rather than the whole answer ───────────
 * A row says "at this school, this role does (or does not) hold this
 * permission". Everything with no row falls through to
 * `DEFAULT_ROLE_PERMISSIONS` in `lib/permissions.ts`.
 *
 * The alternative — storing the complete grant set per school — would mean an
 * empty table is a school where nobody can do anything, and would freeze every
 * school's access model at the moment they first opened the screen: a
 * permission added by a later sprint would arrive granted to no one, silently.
 * Overrides mean a new permission reaches every school with a sensible default
 * and only the rows a school deliberately changed survive.
 *
 * `is_granted` is stored rather than inferred from the row's existence,
 * because both directions are real edits: revoking `fees.write` from an
 * accountant is as much a decision as granting it to a coordinator, and a
 * revocation expressed as an absent row would be indistinguishable from never
 * having been configured.
 *
 * The CHECK constraints derive from the code catalogues, so a role or
 * permission that no longer exists cannot be written.
 */
export const rolePermissions = pgTable(
  'role_permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    permission: text('permission').notNull(),
    isGranted: boolean('is_granted').notNull(),
    /** Who last changed it. A revoked permission gets asked about. */
    updatedBy: uuid('updated_by').references(() => schoolUsers.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Every permission check for a request reads this school's whole set at
    // once, so the tenant index is the one that matters.
    index('role_permissions_location_id_idx').on(table.locationId),
    // The upsert target: saving the matrix writes one row per changed cell.
    uniqueIndex('role_permissions_location_role_permission_idx').on(
      table.locationId,
      table.role,
      table.permission,
    ),
    check(
      'role_permissions_role_check',
      sql.raw(`role IN (${USER_ROLES.map((role) => `'${role}'`).join(', ')})`),
    ),
    check(
      'role_permissions_permission_check',
      sql.raw(
        `permission IN (${PERMISSIONS.map((permission) => `'${permission}'`).join(', ')})`,
      ),
    ),
  ],
);

export type RolePermission = typeof rolePermissions.$inferSelect;
export type NewRolePermission = typeof rolePermissions.$inferInsert;
