import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * schools — the tenant directory, and the anchor for every other table.
 *
 * `location_id` is the GHL Location ID and is the tenant key for the whole
 * platform. `slug` is the subdomain a school is reached on
 * (`slug.platform.com`), so middleware resolves slug -> location_id here.
 *
 * This table replaces Sprint 1's `school_subdomains`: it holds the same
 * subdomain -> location_id mapping plus the school profile the Super Admin
 * panel manages. Branding moved to `school_branding` and module switches to
 * `school_modules`, so there is exactly one row per school in each.
 */
export const schools = pgTable(
  'schools',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id').notNull().unique(),
    name: text('name').notNull(),
    /** Subdomain label: `slug.platform.com`. Lowercase, hyphenated. */
    slug: text('slug').notNull().unique(),
    /**
     * Short uppercase code that prefixes every student ID this school issues,
     * e.g. `GVS` -> `GVS-2025-0001`. Derived from the school name when the
     * Super Admin leaves it blank. Nullable because schools created before
     * Sprint 4 have none until they are next edited.
     */
    schoolCode: text('school_code'),
    city: text('city').notNull(),
    address: text('address'),
    phone: text('phone'),
    email: text('email'),
    principalName: text('principal_name'),
    /** Convenience mirror of `school_branding.logo_url`. */
    logoUrl: text('logo_url'),
    /** Soft delete: deactivated schools keep their data but cannot be reached. */
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('schools_location_id_idx').on(table.locationId),
    // Middleware hits this on every request to a school subdomain.
    index('schools_slug_idx').on(table.slug),
    index('schools_is_active_idx').on(table.isActive),
    index('schools_city_idx').on(table.city),
  ],
);

export type School = typeof schools.$inferSelect;
export type NewSchool = typeof schools.$inferInsert;
