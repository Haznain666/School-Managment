import { eq } from 'drizzle-orm';

import { ghlTokens, schools } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { deleteGhlTokens } from '@/lib/ghl-tokens';
import { requireSuperAdmin } from '@/lib/super-admin-guard';
import { isUuid } from '@/lib/validation';

/**
 * /api/super-admin/schools/[schoolId]/ghl
 *
 * GET     is this school connected, and when does its token expire
 * DELETE  disconnect
 *
 * Reads `ghl_tokens` for metadata only — never the token columns themselves,
 * which are ciphertext and have no business leaving the server even encrypted.
 * `lib/ghl-tokens.ts` owns every read that decrypts.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ schoolId: string }> };

async function locationForSchool(schoolId: string): Promise<string | null> {
  const rows = await db
    .select({ locationId: schools.locationId })
    .from(schools)
    .where(eq(schools.id, schoolId))
    .limit(1);

  return rows[0]?.locationId ?? null;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    await requireSuperAdmin();

    const { schoolId } = await context.params;
    if (!isUuid(schoolId)) {
      return apiFailure('not_found', 'School not found.', 404);
    }

    const locationId = await locationForSchool(schoolId);
    if (locationId === null) {
      return apiFailure('not_found', 'School not found.', 404);
    }

    const rows = await db
      .select({
        expiresAt: ghlTokens.expiresAt,
        tokenType: ghlTokens.tokenType,
        updatedAt: ghlTokens.updatedAt,
      })
      .from(ghlTokens)
      .where(eq(ghlTokens.locationId, locationId))
      .limit(1);

    const row = rows[0];

    return apiSuccess({
      locationId,
      connected: row !== undefined,
      // Not the same as disconnected: a lapsed token refreshes on next use,
      // and only fails if GHL has also revoked the refresh token.
      expiresAt: row?.expiresAt.toISOString() ?? null,
      expired: row === undefined ? null : row.expiresAt.getTime() <= Date.now(),
      tokenType: row?.tokenType ?? null,
      connectedAt: row?.updatedAt.toISOString() ?? null,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    await requireSuperAdmin();

    const { schoolId } = await context.params;
    if (!isUuid(schoolId)) {
      return apiFailure('not_found', 'School not found.', 404);
    }

    const locationId = await locationForSchool(schoolId);
    if (locationId === null) {
      return apiFailure('not_found', 'School not found.', 404);
    }

    await deleteGhlTokens(locationId);
    return apiSuccess({ disconnected: true });
  } catch (error) {
    return handleApiError(error);
  }
}
