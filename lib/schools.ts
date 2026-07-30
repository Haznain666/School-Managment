import { eq } from 'drizzle-orm';

import {
  schoolBranding,
  schoolModules,
  schools,
  selectedPaletteOf,
  type Palette,
} from '@/db/schema';

import { db } from './drizzle';
import { emptyModuleFlags, toModuleFlags, type SchoolModuleFlags } from './platform-modules';
import { isValidSlug } from './slug';

/**
 * Tenant resolution — subdomain slug -> school.
 *
 * `schools` is the only table that may be read without a location_id in hand,
 * because resolving it is *how* we obtain the location_id. Everything
 * downstream is tenant-filtered.
 *
 * This module is Edge-safe (Neon's HTTP driver) so `middleware.ts` can use it.
 */

export interface SchoolRecord {
  id: string;
  slug: string;
  locationId: string;
  schoolName: string;
  city: string;
  isActive: boolean;
  moduleFlags: SchoolModuleFlags;
  colorPalette: Palette | null;
  logoUrl: string | null;
}

/**
 * Extracts the school slug from a Host header.
 *
 * Returns null for the apex domain, `www`, and any host that is not a direct
 * child of `appDomain`.
 */
export function extractSubdomain(host: string, appDomain: string): string | null {
  const hostname = (host.split(':')[0] ?? '').toLowerCase().trim();
  const apex = appDomain.toLowerCase().trim();

  if (hostname === '' || apex === '') return null;
  if (hostname === apex || hostname === `www.${apex}`) return null;
  if (!hostname.endsWith(`.${apex}`)) return null;

  const label = hostname.slice(0, hostname.length - apex.length - 1);

  // Only single-label subdomains map to schools: `a.b.platform.com` does not.
  if (label.includes('.')) return null;

  return isValidSlug(label) ? label : null;
}

/** True for local development and preview hosts, where there is no real subdomain. */
export function isLocalHost(host: string): boolean {
  const hostname = (host.split(':')[0] ?? '').toLowerCase();
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '[::1]' ||
    hostname.endsWith('.local')
  );
}

/**
 * Loads a school plus its module flags and live palette.
 *
 * Three small reads rather than one join: the module rows are a one-to-many
 * and the branding row is optional, so joining would either duplicate the
 * school row or need a subquery for no real gain at this cardinality.
 */
async function hydrate(school: typeof schools.$inferSelect): Promise<SchoolRecord> {
  const [moduleRows, brandingRows] = await Promise.all([
    db
      .select({
        moduleKey: schoolModules.moduleKey,
        isEnabled: schoolModules.isEnabled,
      })
      .from(schoolModules)
      .where(eq(schoolModules.locationId, school.locationId)),
    db
      .select()
      .from(schoolBranding)
      .where(eq(schoolBranding.locationId, school.locationId))
      .limit(1),
  ]);

  const branding = brandingRows[0];

  return {
    id: school.id,
    slug: school.slug,
    locationId: school.locationId,
    schoolName: school.name,
    city: school.city,
    isActive: school.isActive,
    moduleFlags: moduleRows.length === 0 ? emptyModuleFlags() : toModuleFlags(moduleRows),
    colorPalette: branding === undefined ? null : selectedPaletteOf(branding),
    logoUrl: branding?.logoUrl ?? school.logoUrl,
  };
}

/** Looks a school up by its subdomain slug. Null when no such school exists. */
export async function getSchoolBySlug(slug: string): Promise<SchoolRecord | null> {
  const rows = await db.select().from(schools).where(eq(schools.slug, slug)).limit(1);
  const row = rows[0];
  return row === undefined ? null : hydrate(row);
}

/** Sprint 1 name, kept so existing call sites do not need to change. */
export const getSchoolBySubdomain = getSchoolBySlug;

/** Looks a school up by its GHL Location ID. */
export async function getSchoolByLocationId(
  locationId: string,
): Promise<SchoolRecord | null> {
  const rows = await db
    .select()
    .from(schools)
    .where(eq(schools.locationId, locationId))
    .limit(1);

  const row = rows[0];
  return row === undefined ? null : hydrate(row);
}

/** Looks a school up by primary key — the Super Admin panel's addressing. */
export async function getSchoolById(schoolId: string): Promise<SchoolRecord | null> {
  const rows = await db.select().from(schools).where(eq(schools.id, schoolId)).limit(1);
  const row = rows[0];
  return row === undefined ? null : hydrate(row);
}

/**
 * Maps a Super Admin URL's schoolId to the tenant key everything else is
 * filed under. Null when no such school exists.
 *
 * The Super Admin panel addresses schools by primary key, but every child
 * table is keyed by location_id — this is the one hop between the two.
 */
export async function resolveLocationId(schoolId: string): Promise<string | null> {
  const rows = await db
    .select({ locationId: schools.locationId })
    .from(schools)
    .where(eq(schools.id, schoolId))
    .limit(1);

  return rows[0]?.locationId ?? null;
}
