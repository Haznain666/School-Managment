import { headers } from 'next/headers';

import {
  LOCATION_HEADER,
  SCHOOL_NAME_HEADER,
  SUBDOMAIN_HEADER,
} from './auth-middleware';

/**
 * Server-component access to the tenant resolved by `middleware.ts`.
 *
 * For rendering only — it tells a page which school's branding to show. It is
 * NOT an authorisation signal; data access always goes through `withAuth()`,
 * which re-derives the tenant from the caller's verified JWT claims.
 */

export interface TenantHeaders {
  locationId: string | null;
  subdomain: string | null;
  schoolName: string | null;
}

export async function getTenantFromHeaders(): Promise<TenantHeaders> {
  const headerList = await headers();

  const rawName = headerList.get(SCHOOL_NAME_HEADER);

  return {
    locationId: headerList.get(LOCATION_HEADER),
    subdomain: headerList.get(SUBDOMAIN_HEADER),
    // Middleware percent-encodes the name so non-ASCII school names survive
    // the header round-trip.
    schoolName: rawName === null ? null : safeDecode(rawName),
  };
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
