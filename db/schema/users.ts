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

import { branches } from './branches';
import { schools } from './schools';

/**
 * Every role the platform recognises. Mirrors `UserClaims['role']` in
 * `lib/claims.ts` — the two lists must stay in sync.
 */
export const USER_ROLES = [
  'super_admin',
  'school_admin',
  'principal',
  'vice_principal',
  'coordinator',
  'teacher',
  'hr_manager',
  'accountant',
  'marketing',
  'student',
  'parent',
] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_TYPES = ['staff', 'student', 'parent'] as const;
export type UserType = (typeof USER_TYPES)[number];

export const USER_STATUSES = ['active', 'suspended', 'inactive'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/**
 * users — every human who can sign in, scoped to one school.
 *
 * `auth_user_id` is the join key to Supabase Auth (`auth.users.id`).
 *
 * It carries no claims. Tenant identity comes from the subdomain and
 * authorization from `school_users`, read per request — see `lib/school-auth.ts`.
 * Until Stage 4 this said the opposite, because Firebase custom claims on the
 * matching account were then the authority.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    authUserId: text('auth_user_id').notNull().unique(),
    email: text('email').notNull(),
    phone: text('phone'),
    userType: text('user_type').notNull().$type<UserType>(),
    status: text('status').notNull().default('active').$type<UserStatus>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('users_location_id_idx').on(table.locationId),
    // Email is unique per school, not globally — the same parent may exist at
    // two different schools.
    uniqueIndex('users_location_id_email_idx').on(table.locationId, table.email),
    index('users_auth_user_id_idx').on(table.authUserId),
    check(
      'users_user_type_check',
      sql`${table.userType} IN ('staff', 'student', 'parent')`,
    ),
  ],
);

/**
 * user_roles — a user may hold more than one role (the "dual role" case, e.g.
 * a teacher who is also a parent). `branch_id = NULL` means all branches.
 */
export const userRoles = pgTable(
  'user_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    role: text('role').notNull().$type<UserRole>(),
    /** NULL = access to every branch of this school. */
    branchId: uuid('branch_id').references(() => branches.id, {
      onDelete: 'set null',
    }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('user_roles_location_id_idx').on(table.locationId),
    index('user_roles_user_id_idx').on(table.userId),
    index('user_roles_location_id_role_idx').on(table.locationId, table.role),
    check(
      'user_roles_role_check',
      sql`${table.role} IN ('super_admin', 'school_admin', 'principal', 'vice_principal', 'coordinator', 'teacher', 'hr_manager', 'accountant', 'marketing', 'student', 'parent')`,
    ),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserRoleRow = typeof userRoles.$inferSelect;
export type NewUserRoleRow = typeof userRoles.$inferInsert;
