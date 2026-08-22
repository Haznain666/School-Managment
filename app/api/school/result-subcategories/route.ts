import { and, eq, isNull, sql } from 'drizzle-orm';

import { resultSubcategories } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { getExamSettings, listResultSubcategories } from '@/lib/exam-queries';
import { normalizeHex, subcategoryProblem } from '@/lib/result-subcategories';
import { readString } from '@/lib/validation';

/**
 * /api/school/result-subcategories
 *
 * GET  the school's performance descriptors, best first, with the colour switch
 * POST add another
 *
 * The settings screen needs the switch alongside the list — whether a chip is
 * painted is not a property of the chip — so the GET carries both rather than
 * making the client ask twice for one screen.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);
      const includeArchived = url.searchParams.get('includeArchived') === 'true';

      const [subcategories, settings] = await Promise.all([
        listResultSubcategories(auth.locationId, { includeArchived }),
        getExamSettings(auth.locationId),
      ]);

      return apiSuccess({ subcategories, settings });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'exams.read' },
);

interface CreateBody {
  label?: unknown;
  colorHex?: unknown;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<CreateBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const label = readString(body.label);
      const colorHex = normalizeHex(
        typeof body.colorHex === 'string' ? body.colorHex : null,
      );

      // The existing labels are canonicalised the same way the partial unique
      // index is, so the clerk gets a sentence rather than a 500.
      const existing = await listResultSubcategories(auth.locationId);
      const problem = subcategoryProblem(
        label,
        typeof body.colorHex === 'string' ? body.colorHex : null,
        existing.map((row) => row.label.trim().toLowerCase()),
      );
      if (problem !== null) return apiFailure('invalid_body', problem, 400);

      const last = await db
        .select({ highest: sql<number | null>`max(${resultSubcategories.sortOrder})` })
        .from(resultSubcategories)
        .where(
          and(
            eq(resultSubcategories.locationId, auth.locationId),
            isNull(resultSubcategories.archivedAt),
          ),
        );

      const created = await db
        .insert(resultSubcategories)
        .values({
          // Tenant from the verified session, never from the body.
          locationId: auth.locationId,
          label: label.trim(),
          colorHex,
          sortOrder: (last[0]?.highest ?? -1) + 1,
        })
        .returning({ id: resultSubcategories.id });

      return apiSuccess({ subcategoryId: created[0]?.id ?? null }, 201);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'exams.write' },
);
