import { eq } from 'drizzle-orm';

import { ghlTokens, schools } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { GhlAgencyError, GhlApiError, getGhlLocation } from '@/lib/ghl-client';
import { GhlTokenError } from '@/lib/ghl-tokens';
import { requireSuperAdmin } from '@/lib/super-admin-guard';
import { isUuid } from '@/lib/validation';

/**
 * GET /api/super-admin/schools/[schoolId]/ghl
 *
 * Verifies that the Location ID stored on a school actually resolves to a
 * reachable GHL sub-account.
 *
 * There is no "connect" step to report on. A school's GHL setup is the Location
 * ID entered when it was created, and the agency credential is what authorises
 * calls against it — so the only question worth asking is whether that pairing
 * works, which is answered by making a real call rather than by inspecting a
 * table.
 *
 * `reachable: false` after creating a school almost always means the Location
 * ID was mistyped, or the sub-account is not one this agency administers.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ schoolId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    await requireSuperAdmin();

    const { schoolId } = await context.params;
    if (!isUuid(schoolId)) {
      return apiFailure('not_found', 'School not found.', 404);
    }

    const rows = await db
      .select({ locationId: schools.locationId, name: schools.name })
      .from(schools)
      .where(eq(schools.id, schoolId))
      .limit(1);

    const school = rows[0];
    if (school === undefined) {
      return apiFailure('not_found', 'School not found.', 404);
    }

    // Metadata only — never the token columns, which are ciphertext and have no
    // business leaving the server even encrypted. A row here is optional: it
    // exists only where a narrower per-location token has been installed.
    const tokenRows = await db
      .select({ expiresAt: ghlTokens.expiresAt, tokenType: ghlTokens.tokenType })
      .from(ghlTokens)
      .where(eq(ghlTokens.locationId, school.locationId))
      .limit(1);

    let reachable = false;
    let ghlName: string | null = null;
    let reason: string | null = null;

    try {
      const location = await getGhlLocation(school.locationId);
      reachable = true;
      ghlName = location.name;
    } catch (error) {
      if (error instanceof GhlApiError) {
        reason =
          error.status === 404
            ? 'GoHighLevel does not recognise this Location ID.'
            : `GoHighLevel returned ${error.status}.`;
      } else if (error instanceof GhlAgencyError) {
        reason = `GoHighLevel returned ${error.status} for the agency credential.`;
      } else if (error instanceof GhlTokenError) {
        reason = 'No credential is configured for this sub-account.';
      } else {
        reason = 'The GoHighLevel check could not be completed.';
      }

      console.warn(
        `[ghl-verify] ${school.locationId} unreachable:`,
        error instanceof Error ? error.message : error,
      );
    }

    return apiSuccess({
      locationId: school.locationId,
      reachable,
      // The sub-account's own name in GHL. When it does not look like the
      // school, the Location ID belongs to somebody else.
      ghlLocationName: ghlName,
      reason,
      credential: tokenRows[0] === undefined ? 'agency' : 'location_oauth',
    });
  } catch (error) {
    return handleApiError(error);
  }
}
