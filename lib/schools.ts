import { eq } from 'drizzle-orm';

import {
  DEFAULT_MODULE_FLAGS,
  schoolSubdomains,
  type SchoolColorPalette,
  type SchoolModuleFlags,
  type SchoolStatus,
} from '@/db/schema';

import { db } from './drizzle';

/**
 * Tenant resolution — subdomain -> school.
 *
 * `school_subdomains` is the only table that may be read without a
 * location_id in hand, because resolving it is *how* we obtain the
 * location_id. Everything downstream is tenant-filtered.
 *
 * This module is Edge-safe (Neon's HTTP driver) so `middleware.ts` can use it.
 */

export interface SchoolRecord {
  subdomain: string;
  locationId: string;
  schoolName: string;
  status: SchoolStatus;
  moduleFlags: SchoolModuleFlags;
  colorPalette: SchoolColorPalette | null;
  logoUrl: string | null;
}

/**
 * Subdomains that can never belong to a school — they are platform surfaces or
 * conventional infrastructure names.
 */
export const RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set([
  'www',
  'app',
  'api',
  'admin',
  'super-admin',
  'auth',
  'login',
  'static',
  'assets',
  'cdn',
  'mail',
  'status',
]);

/** RFC-1123 label: lowercase alphanumerics and hyphens, 1–63 chars. */
const SUBDOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export function isValidSubdomain(candidate: string): boolean {
  return SUBDOMAIN_PATTERN.test(candidate) && !RESERVED_SUBDOMAINS.has(candidate);
}

/**
 * Extracts the school subdomain from a Host header.
 *
 * Returns null for the apex domain, `www`, localhost, and any host that is not
 * a direct child of `appDomain`.
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

  return isValidSubdomain(label) ? label : null;
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

function toRecord(row: {
  subdomain: string;
  locationId: string;
  schoolName: string;
  status: SchoolStatus;
  moduleFlags: SchoolModuleFlags | null;
  colorPalette: SchoolColorPalette | null;
  logoUrl: string | null;
}): SchoolRecord {
  return {
    subdomain: row.subdomain,
    locationId: row.locationId,
    schoolName: row.schoolName,
    status: row.status,
    moduleFlags: row.moduleFlags ?? DEFAULT_MODULE_FLAGS,
    colorPalette: row.colorPalette,
    logoUrl: row.logoUrl,
  };
}

/** Looks a school up by its subdomain. Null when no such school exists. */
export async function getSchoolBySubdomain(
  subdomain: string,
): Promise<SchoolRecord | null> {
  const rows = await db
    .select({
      subdomain: schoolSubdomains.subdomain,
      locationId: schoolSubdomains.locationId,
      schoolName: schoolSubdomains.schoolName,
      status: schoolSubdomains.status,
      moduleFlags: schoolSubdomains.moduleFlags,
      colorPalette: schoolSubdomains.colorPalette,
      logoUrl: schoolSubdomains.logoUrl,
    })
    .from(schoolSubdomains)
    .where(eq(schoolSubdomains.subdomain, subdomain))
    .limit(1);

  const row = rows[0];
  return row === undefined ? null : toRecord(row);
}

/** Looks a school up by its GHL Location ID. */
export async function getSchoolByLocationId(
  locationId: string,
): Promise<SchoolRecord | null> {
  const rows = await db
    .select({
      subdomain: schoolSubdomains.subdomain,
      locationId: schoolSubdomains.locationId,
      schoolName: schoolSubdomains.schoolName,
      status: schoolSubdomains.status,
      moduleFlags: schoolSubdomains.moduleFlags,
      colorPalette: schoolSubdomains.colorPalette,
      logoUrl: schoolSubdomains.logoUrl,
    })
    .from(schoolSubdomains)
    .where(eq(schoolSubdomains.locationId, locationId))
    .limit(1);

  const row = rows[0];
  return row === undefined ? null : toRecord(row);
}
