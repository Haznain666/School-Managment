import { eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { schoolBranding, schools, selectedPaletteOf } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { applyBrandingToSchool, applyPresetToSchool } from '@/lib/branding';
import { db } from '@/lib/drizzle';
import { isPresetKey } from '@/lib/palette-presets';
import { resolveLocationId } from '@/lib/schools';
import { requireSuperAdmin } from '@/lib/super-admin-guard';
import { isUuid } from '@/lib/validation';

/**
 * /api/super-admin/schools/[schoolId]/branding
 *
 * GET   the school's logo and its three candidate palettes
 * PATCH switch which palette is live
 *
 * Uploading a new logo (and regenerating palettes) is a separate endpoint,
 * `./branding/upload`, because it takes multipart rather than JSON.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ schoolId: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    await requireSuperAdmin();

    const { schoolId } = await context.params;
    if (!isUuid(schoolId)) {
      return apiFailure('not_found', 'School not found.', 404);
    }

    const locationId = await resolveLocationId(schoolId);
    if (locationId === null) {
      return apiFailure('not_found', 'School not found.', 404);
    }

    const rows = await db
      .select()
      .from(schoolBranding)
      .where(eq(schoolBranding.locationId, locationId))
      .limit(1);

    const branding = rows[0];

    // No row yet simply means nothing has been uploaded — not an error.
    if (branding === undefined) {
      return apiSuccess({
        branding: null,
        palettes: [],
        selectedPalette: 0,
        presetKey: null,
        logoUrl: null,
      });
    }

    return apiSuccess({
      branding,
      palettes: [branding.palette0, branding.palette1, branding.palette2],
      selectedPalette: branding.selectedPalette,
      presetKey: branding.presetKey,
      logoUrl: branding.logoUrl,
      activePalette: selectedPaletteOf(branding),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

interface UpdateBrandingBody {
  selectedPalette?: unknown;
  presetKey?: unknown;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    await requireSuperAdmin();

    const { schoolId } = await context.params;
    if (!isUuid(schoolId)) {
      return apiFailure('not_found', 'School not found.', 404);
    }

    const locationId = await resolveLocationId(schoolId);
    if (locationId === null) {
      return apiFailure('not_found', 'School not found.', 404);
    }

    const body = await readJsonBody<UpdateBrandingBody>(request);

    /**
     * A preset is applied when `presetKey` is a non-null string. Sending
     * `presetKey: null` explicitly means "clear it", which is what selecting a
     * derived palette does — so an absent key and a null key are deliberately
     * different, and only the absent case falls through to `selectedPalette`.
     */
    if (body?.presetKey != null) {
      if (!isPresetKey(body.presetKey)) {
        return apiFailure('invalid_body', 'That palette preset does not exist.', 400);
      }

      const applied = await applyPresetToSchool(locationId, body.presetKey);
      if (applied === null) {
        return apiFailure('invalid_body', 'That palette preset does not exist.', 400);
      }

      await db
        .update(schools)
        .set({ updatedAt: new Date() })
        .where(eq(schools.locationId, locationId));

      return apiSuccess({ presetKey: body.presetKey, palette: applied });
    }

    const index = body?.selectedPalette;

    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > 2) {
      return apiFailure('invalid_body', 'selectedPalette must be 0, 1 or 2.', 400);
    }

    const applied = await applyBrandingToSchool(locationId, index);

    if (applied === null) {
      return apiFailure(
        'palette_unavailable',
        'That palette has not been generated. Upload a logo first.',
        409,
      );
    }

    // Keep the convenience mirror on `schools` in step.
    await db
      .update(schools)
      .set({ updatedAt: new Date() })
      .where(eq(schools.locationId, locationId));

    return apiSuccess({ selectedPalette: index, palette: applied });
  } catch (error) {
    return handleApiError(error);
  }
}
