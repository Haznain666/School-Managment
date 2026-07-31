import { and, desc, eq, inArray } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { admissionApplications } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { InvalidPhoneError, normalizePhone } from '@/lib/phone';
import { SCHOOL_LOCATION_HEADER } from '@/lib/school-context';

/**
 * GET /api/admissions/check?phone=03001234567
 *
 * Tells the public form whether this number already has an application in
 * flight, so a parent who has forgotten they applied is warned before they
 * submit a second one.
 *
 * Public, like the form it serves. It answers only for the number the caller
 * already knows and returns nothing beyond a status word — no name, no student,
 * nothing that could turn it into a lookup tool for someone else's family.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OPEN_STATUSES = ['pending', 'reviewing', 'accepted'] as const;

export async function GET(request: NextRequest) {
  try {
    const locationId = request.headers.get(SCHOOL_LOCATION_HEADER);
    if (locationId === null || locationId === '') {
      return apiFailure('no_school', 'No school resolved for this address.', 400);
    }

    const url = new URL(request.url);
    const raw = url.searchParams.get('phone') ?? '';

    let phone: string;
    try {
      phone = normalizePhone(raw);
    } catch (error) {
      if (error instanceof InvalidPhoneError) {
        // Not an error worth surfacing: the form calls this while the number is
        // still being typed.
        return apiSuccess({ exists: false });
      }
      throw error;
    }

    const rows = await db
      .select({ status: admissionApplications.status })
      .from(admissionApplications)
      .where(
        and(
          eq(admissionApplications.locationId, locationId),
          eq(admissionApplications.guardianPhone, phone),
          inArray(admissionApplications.status, [...OPEN_STATUSES]),
        ),
      )
      .orderBy(desc(admissionApplications.submittedAt))
      .limit(1);

    const found = rows[0];
    if (found === undefined) return apiSuccess({ exists: false });

    return apiSuccess({ exists: true, status: found.status });
  } catch (error) {
    return handleApiError(error);
  }
}
