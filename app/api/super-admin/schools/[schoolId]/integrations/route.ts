import { and, eq, ne } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { schools } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { isUuid, readOptionalString } from '@/lib/validation';
import { requireSuperAdmin } from '@/lib/super-admin-guard';

/**
 * /api/super-admin/schools/[schoolId]/integrations
 *
 * GET   which third-party accounts this school is connected to
 * PATCH connect or disconnect one
 *
 * ── Why this route had to exist ──────────────────────────────────────────
 * `schools.ghl_location_id` has been readable since GoHighLevel was decoupled
 * from tenant identity, and `ghlLocationFor()` already tells operators to
 * "connect it from the Integrations tab" — but nothing could write the column.
 * Every school was therefore permanently unconnected, and that error message
 * pointed at a tab that did not exist.
 *
 * ── Connected means the column is set ────────────────────────────────────
 * There is no separate enabled flag. See `PLATFORM_INTEGRATIONS` in
 * `lib/platform-modules.ts` for why a flag beside the id would be a second
 * answer to a question that must have one.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ schoolId: string }> };

/**
 * GoHighLevel sub-account ids are opaque short strings — this does not try to
 * validate them as GHL would, only to refuse what is obviously not one, so a
 * pasted URL or an entire API key does not end up in the column.
 */
const GHL_LOCATION_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** Postgres unique_violation. The id column is unique across all schools. */
const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    await requireSuperAdmin();

    const { schoolId } = await context.params;
    if (!isUuid(schoolId)) {
      return apiFailure('not_found', 'School not found.', 404);
    }

    const rows = await db
      .select({ ghlLocationId: schools.ghlLocationId })
      .from(schools)
      .where(eq(schools.id, schoolId))
      .limit(1);

    const school = rows[0];
    if (school === undefined) {
      return apiFailure('not_found', 'School not found.', 404);
    }

    return apiSuccess({
      gohighlevel: {
        connected: school.ghlLocationId !== null && school.ghlLocationId !== '',
        locationId: school.ghlLocationId,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

interface UpdateIntegrationsBody {
  /** The GHL sub-account id, or null to disconnect. */
  ghl_location_id?: unknown;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    await requireSuperAdmin();

    const { schoolId } = await context.params;
    if (!isUuid(schoolId)) {
      return apiFailure('not_found', 'School not found.', 404);
    }

    const body = await readJsonBody<UpdateIntegrationsBody>(request);
    if (body === null || !('ghl_location_id' in body)) {
      return apiFailure(
        'invalid_body',
        'Expected { ghl_location_id: string | null }.',
        400,
      );
    }

    const value = readOptionalString(body.ghl_location_id);

    if (value !== null && !GHL_LOCATION_ID.test(value)) {
      return apiFailure(
        'invalid_body',
        'That does not look like a GHL Location ID. It is the short ' +
          'identifier from the sub-account — letters and digits, no spaces — ' +
          'not the sub-account URL or an API key.',
        400,
      );
    }

    const existing = await db
      .select({ id: schools.id })
      .from(schools)
      .where(eq(schools.id, schoolId))
      .limit(1);

    if (existing[0] === undefined) {
      return apiFailure('not_found', 'School not found.', 404);
    }

    // Checked before writing so the operator gets the name of the school
    // holding it. The unique constraint is still the thing that guarantees it
    // — this only buys a better message, and the catch below covers the race.
    if (value !== null) {
      const taken = await db
        .select({ name: schools.name })
        .from(schools)
        .where(and(eq(schools.ghlLocationId, value), ne(schools.id, schoolId)))
        .limit(1);

      const other = taken[0];
      if (other !== undefined) {
        return apiFailure(
          'conflict',
          `${other.name} is already connected to that GHL sub-account. One ` +
            'sub-account belongs to one school.',
          409,
        );
      }
    }

    try {
      await db
        .update(schools)
        .set({ ghlLocationId: value, updatedAt: new Date() })
        .where(eq(schools.id, schoolId));
    } catch (error) {
      if (isUniqueViolation(error)) {
        return apiFailure(
          'conflict',
          'Another school was connected to that GHL sub-account a moment ago.',
          409,
        );
      }
      throw error;
    }

    return apiSuccess({
      gohighlevel: { connected: value !== null, locationId: value },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
