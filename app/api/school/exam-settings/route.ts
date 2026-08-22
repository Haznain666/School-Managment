import { sql } from 'drizzle-orm';

import { schoolExamSettings } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { getExamSettings } from '@/lib/exam-queries';

/**
 * /api/school/exam-settings
 *
 * GET   the two exam-wide switches, defaulted
 * PATCH set either of them
 *
 * ── The row is created on first write, not at provisioning ───────────────
 * A school that has never opened the settings screen has no row and gets the
 * defaults, which are the behaviour the product had before this sprint. That is
 * the property `getExamSettings` is written around and this upsert preserves:
 * nothing else in the codebase may assume the row exists.
 *
 * Switching colour coding off is retroactive by construction — the flag is read
 * at render time and never copied onto a result row — so a school that decides
 * its report cards look like a traffic light gets the whole archive back in one
 * click.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (_request, auth) => {
    try {
      return apiSuccess({ settings: await getExamSettings(auth.locationId) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'exams.read' },
);

interface UpdateBody {
  colorCodingEnabled?: unknown;
  teachersCanViewLegacyResults?: unknown;
}

export const PATCH = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<UpdateBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const current = await getExamSettings(auth.locationId);
      const next = { ...current };

      for (const key of ['colorCodingEnabled', 'teachersCanViewLegacyResults'] as const) {
        const value = body[key];
        if (value === undefined) continue;
        if (typeof value !== 'boolean') {
          return apiFailure('invalid_body', `${key} must be true or false.`, 400);
        }
        next[key] = value;
      }

      const now = new Date();

      await db
        .insert(schoolExamSettings)
        .values({
          // Tenant from the verified session, never from the body.
          locationId: auth.locationId,
          colorCodingEnabled: next.colorCodingEnabled,
          teachersCanViewLegacyResults: next.teachersCanViewLegacyResults,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: schoolExamSettings.locationId,
          set: {
            colorCodingEnabled: sql`excluded.color_coding_enabled`,
            teachersCanViewLegacyResults: sql`excluded.teachers_can_view_legacy_results`,
            updatedAt: sql`excluded.updated_at`,
          },
        });

      return apiSuccess({ settings: next });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'exams.write' },
);
