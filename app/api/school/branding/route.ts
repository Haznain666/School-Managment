import { eq } from 'drizzle-orm';

import { schoolBranding, schools, selectedPaletteOf } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { applyBrandingToSchool } from '@/lib/branding';
import { db } from '@/lib/drizzle';

/**
 * /api/school/branding
 *
 * GET   this school's logo and its three candidate palettes
 * PATCH switch which palette is live
 *
 * The school-side twin of the Super Admin route of the same shape. It differs
 * in exactly one way, and it is the important one: the tenant comes from the
 * verified session rather than from a `[schoolId]` path segment. There is no
 * id to pass, so there is no id to tamper with — a school can only ever reach
 * its own branding here.
 *
 * Uploading a new logo is `./branding/upload`, because it takes multipart
 * rather than JSON.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (_request, auth) => {
    try {
      const rows = await db
        .select()
        .from(schoolBranding)
        .where(eq(schoolBranding.locationId, auth.locationId))
        .limit(1);

      const branding = rows[0];

      // No row yet simply means nothing has been uploaded — not an error.
      if (branding === undefined) {
        return apiSuccess({
          logoUrl: null,
          palettes: [],
          selectedPalette: 0,
          activePalette: null,
        });
      }

      return apiSuccess({
        logoUrl: branding.logoUrl,
        palettes: [branding.palette0, branding.palette1, branding.palette2],
        selectedPalette: branding.selectedPalette,
        activePalette: selectedPaletteOf(branding),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'settings.read' },
);

interface UpdateBrandingBody {
  selectedPalette?: unknown;
}

export const PATCH = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<UpdateBrandingBody>(request);
      const index = body?.selectedPalette;

      if (
        typeof index !== 'number' ||
        !Number.isInteger(index) ||
        index < 0 ||
        index > 2
      ) {
        return apiFailure('invalid_body', 'Choose one of the three palettes.', 400);
      }

      const applied = await applyBrandingToSchool(auth.locationId, index);

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
        .where(eq(schools.locationId, auth.locationId));

      return apiSuccess({ selectedPalette: index, palette: applied });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'settings.write' },
);
