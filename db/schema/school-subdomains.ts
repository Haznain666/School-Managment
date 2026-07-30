import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Colours extracted from a school's logo, used to brand their portal.
 * Stored as JSONB so the palette can grow without a migration.
 */
export interface SchoolColorPalette {
  primary: string;
  secondary: string;
  accent: string;
  surface: string;
  text: string;
}

/**
 * Per-school feature switches. A module that is `false` is hidden from
 * navigation AND rejected at the API layer.
 */
export interface SchoolModuleFlags {
  events: boolean;
  hr: boolean;
  payroll: boolean;
  accounts: boolean;
  lms: boolean;
}

export const DEFAULT_MODULE_FLAGS: SchoolModuleFlags = {
  events: false,
  hr: false,
  payroll: false,
  accounts: false,
  lms: false,
};

export const SCHOOL_STATUSES = ['active', 'suspended', 'inactive'] as const;
export type SchoolStatus = (typeof SCHOOL_STATUSES)[number];

/**
 * school_subdomains — the ONLY subdomain -> location_id mapping table.
 *
 * `location_id` is the GHL Location ID and is the tenant key for the entire
 * platform. Every other table carries it as `location_id TEXT NOT NULL`.
 * This table is the one exception: it is keyed by subdomain because it is what
 * middleware resolves *before* a tenant is known.
 */
export const schoolSubdomains = pgTable(
  'school_subdomains',
  {
    subdomain: text('subdomain').primaryKey(),
    locationId: text('location_id').notNull().unique(),
    schoolName: text('school_name').notNull(),
    status: text('status').notNull().default('active').$type<SchoolStatus>(),
    moduleFlags: jsonb('module_flags')
      .notNull()
      .default(sql`'{"events":false,"hr":false,"payroll":false,"accounts":false,"lms":false}'::jsonb`)
      .$type<SchoolModuleFlags>(),
    colorPalette: jsonb('color_palette').$type<SchoolColorPalette>(),
    logoUrl: text('logo_url'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Middleware resolves subdomain -> location_id on every request; the reverse
    // lookup (location_id -> school) is just as hot in admin tooling.
    index('school_subdomains_location_id_idx').on(table.locationId),
    index('school_subdomains_status_idx').on(table.status),
  ],
);

export type SchoolSubdomain = typeof schoolSubdomains.$inferSelect;
export type NewSchoolSubdomain = typeof schoolSubdomains.$inferInsert;
