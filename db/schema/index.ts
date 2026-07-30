/**
 * Drizzle schema barrel — this file is what `drizzle.config.ts` points at and
 * what `lib/drizzle.ts` passes to the ORM. Every new table must be exported
 * here or it will not appear in generated migrations.
 *
 * Tenancy invariant: every table except `school_subdomains` carries
 * `location_id TEXT NOT NULL` (the GHL Location ID) and is indexed on it.
 */
export * from './school-subdomains';
export * from './ghl-tokens';
export * from './branches';
export * from './users';
export * from './students';
export * from './staff';
