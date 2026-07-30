import 'server-only';

import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';

import { schoolBranding, schools, selectedPaletteOf, type Palette } from '@/db/schema';

import { db } from './drizzle';
import {
  SCHOOL_ID_HEADER,
  SCHOOL_LOCATION_HEADER,
  SCHOOL_SLUG_HEADER,
} from './school-context';

/**
 * Server-component access to the school middleware resolved, plus its branding.
 *
 * For rendering only — it decides which logo and palette to show. It is never
 * an authorisation signal: data access goes through `withSchoolAuth`, which
 * re-derives the tenant from the verified session cookie.
 */

export interface SchoolBrandingInfo {
  locationId: string;
  schoolId: string | null;
  slug: string;
  name: string;
  logoUrl: string | null;
  palette: Palette | null;
}

/** Reads the tenant headers stamped by middleware. */
export async function getSchoolHeaders(): Promise<{
  locationId: string | null;
  schoolId: string | null;
  slug: string | null;
}> {
  const headerList = await headers();
  return {
    locationId: headerList.get(SCHOOL_LOCATION_HEADER),
    schoolId: headerList.get(SCHOOL_ID_HEADER),
    slug: headerList.get(SCHOOL_SLUG_HEADER),
  };
}

/** Loads a school's display identity and active palette by location id. */
export async function getSchoolBranding(
  locationId: string,
): Promise<SchoolBrandingInfo | null> {
  const rows = await db
    .select({
      id: schools.id,
      slug: schools.slug,
      name: schools.name,
      schoolLogo: schools.logoUrl,
      isActive: schools.isActive,
    })
    .from(schools)
    .where(eq(schools.locationId, locationId))
    .limit(1);

  const school = rows[0];
  if (school === undefined) return null;

  const brandingRows = await db
    .select()
    .from(schoolBranding)
    .where(eq(schoolBranding.locationId, locationId))
    .limit(1);

  const branding = brandingRows[0];

  return {
    locationId,
    schoolId: school.id,
    slug: school.slug,
    name: school.name,
    logoUrl: branding?.logoUrl ?? school.schoolLogo,
    palette: branding === undefined ? null : selectedPaletteOf(branding),
  };
}

/** Convenience: resolve the current request's school branding in one call. */
export async function getCurrentSchoolBranding(): Promise<SchoolBrandingInfo | null> {
  const { locationId } = await getSchoolHeaders();
  if (locationId === null || locationId === '') return null;
  return getSchoolBranding(locationId);
}
