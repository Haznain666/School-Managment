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
 * ── `location_id` is the tenant key, and no longer a GHL value ───────────
 * It began life as the GoHighLevel Location ID, which meant no school could
 * exist without a GHL sub-account. GHL is now opt-in per school, so a school
 * owns its own tenant identity: `location_id` is set to the school's own `id`
 * at creation, and `ghl_location_id` below holds the GHL sub-account if and
 * when one is connected.
 *
 * The column keeps its name deliberately. It is the foreign key on 43 tables
 * and appears in ~1,241 places in code; renaming it buys accurate naming and
 * costs an unreviewable diff where every miss is a runtime failure rather than
 * a compile error. Read it as "tenant key" wherever it appears.
 *
 * `slug` is the subdomain a school is reached on (`slug.platform.com`), so
 * middleware resolves slug -> location_id here.
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
    /**
     * The tenant key. Equal to `id` for every school created since GHL became
     * optional; older rows carry the GHL Location ID they were provisioned
     * with, which is why this is not simply a generated column.
     */
    locationId: text('location_id').notNull().unique(),
    /**
     * The GoHighLevel sub-account, when this school has connected one.
     *
     * Null for every school that has not. This is the value that goes to the
     * GHL API — `lib/ghl-client.ts` resolves it from the tenant key rather
     * than assuming the two are the same, which they no longer are.
     */
    ghlLocationId: text('ghl_location_id').unique(),
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

    /**
     * State of `<slug>.<PLATFORM_BASE_DOMAIN>` at the hosting provider.
     *
     * ── Why this is stored rather than derived ───────────────────────────
     * A school row and a DNS record live in two different systems, and the
     * second one can fail while the first succeeds. Creating a school must
     * not depend on a third-party API being reachable, so provisioning is
     * attempted after the insert and its outcome recorded here. Without this
     * column a failed provision is invisible: the school exists, the operator
     * is handed a URL, and the URL does not resolve.
     *
     * `pending`      — created, not yet attempted.
     * `provisioning` — the parked domain exists; DNS and TLS are still settling
     *                  (measured at roughly three minutes on Hostinger).
     * `ready`        — verified reachable over HTTPS.
     * `failed`       — the last attempt failed; `subdomainError` says why and
     *                  the operator can retry.
     * `unmanaged`    — no hosting API token is configured, so provisioning is
     *                  a manual step. Deliberately distinct from `failed`:
     *                  nothing is broken and there is nothing to retry.
     */
    subdomainStatus: text('subdomain_status').notNull().default('pending'),
    /** Operator-facing reason for the last failure. Never holds a token. */
    subdomainError: text('subdomain_error'),
    /** When the parked domain was last confirmed to exist at the provider. */
    subdomainProvisionedAt: timestamp('subdomain_provisioned_at', {
      withTimezone: true,
    }),
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
