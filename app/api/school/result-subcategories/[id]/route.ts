import { and, eq } from 'drizzle-orm';

import { resultSubcategories } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { listResultSubcategories, subcategoryUsage } from '@/lib/exam-queries';
import { normalizeHex, subcategoryProblem } from '@/lib/result-subcategories';
import { isUuid, readString } from '@/lib/validation';

/**
 * /api/school/result-subcategories/[id]
 *
 * PATCH  rename, recolour, or restore an archived one
 * DELETE archive — or refuse, when the descriptor has been awarded
 *
 * ── Why a used descriptor cannot be deleted ──────────────────────────────
 * A sub-category that has been awarded is part of a report card the school has
 * issued. Removing the row would empty a column on a document a parent is
 * holding, months after the fact and with nothing anywhere reporting it. So
 * the refusal names the count — "used on 412 subject results and 38 term
 * results" is a decision a head can make; "this is in use" is not — and offers
 * archive, which hides it from every picker and leaves every historical sheet
 * rendering exactly as it was issued.
 *
 * An unused descriptor is archived too rather than deleted. A school that
 * deletes one the same afternoon it created it loses nothing either way, and
 * one code path is one fewer thing to get wrong.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

interface UpdateBody {
  label?: unknown;
  colorHex?: unknown;
  isArchived?: unknown;
}

export const PATCH = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { id } = await context.params;
      if (!isUuid(id)) return apiFailure('not_found', 'Sub-category not found.', 404);

      const all = await listResultSubcategories(auth.locationId, {
        includeArchived: true,
      });
      const existing = all.find((row) => row.id === id);
      if (existing === undefined) {
        return apiFailure('not_found', 'Sub-category not found.', 404);
      }

      const body = await readJsonBody<UpdateBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const updates: Partial<typeof resultSubcategories.$inferInsert> = {};

      if (body.label !== undefined || body.colorHex !== undefined) {
        const label = body.label === undefined ? existing.label : readString(body.label);
        const rawColor =
          body.colorHex === undefined
            ? existing.colorHex
            : typeof body.colorHex === 'string'
              ? body.colorHex
              : null;

        const problem = subcategoryProblem(
          label,
          rawColor,
          all
            .filter((row) => row.id !== id && !row.isArchived)
            .map((row) => row.label.trim().toLowerCase()),
        );
        if (problem !== null) return apiFailure('invalid_body', problem, 400);

        updates.label = label.trim();
        updates.colorHex = normalizeHex(rawColor);
      }

      if (body.isArchived !== undefined) {
        if (typeof body.isArchived !== 'boolean') {
          return apiFailure('invalid_body', 'isArchived must be true or false.', 400);
        }

        if (!body.isArchived && existing.isArchived) {
          // Restoring has to clear the partial unique index the same way a
          // create does: another descriptor may have taken the name meanwhile.
          const clash = all.find(
            (row) =>
              row.id !== id &&
              !row.isArchived &&
              row.label.trim().toLowerCase() === existing.label.trim().toLowerCase(),
          );
          if (clash !== undefined) {
            return apiFailure(
              'duplicate',
              `There is already a sub-category called "${existing.label}". Rename that one first.`,
              409,
            );
          }
        }

        updates.archivedAt = body.isArchived ? new Date() : null;
      }

      if (Object.keys(updates).length === 0) {
        return apiFailure('invalid_body', 'No fields to update.', 400);
      }

      updates.updatedAt = new Date();

      await db
        .update(resultSubcategories)
        .set(updates)
        .where(
          and(
            eq(resultSubcategories.locationId, auth.locationId),
            eq(resultSubcategories.id, id),
          ),
        );

      return apiSuccess({ subcategoryId: id });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'exams.write' },
);

export const DELETE = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { id } = await context.params;
      if (!isUuid(id)) return apiFailure('not_found', 'Sub-category not found.', 404);

      const all = await listResultSubcategories(auth.locationId, {
        includeArchived: true,
      });
      const existing = all.find((row) => row.id === id);
      if (existing === undefined) {
        return apiFailure('not_found', 'Sub-category not found.', 404);
      }
      if (existing.isArchived) {
        return apiSuccess({ subcategoryId: id, alreadyArchived: true });
      }

      const usage = await subcategoryUsage(auth.locationId, id);
      const total = usage.subjectResults + usage.termResults + usage.criteria;

      if (total > 0) {
        const parts: string[] = [];
        if (usage.subjectResults > 0) {
          parts.push(
            `${usage.subjectResults} subject result${usage.subjectResults === 1 ? '' : 's'}`,
          );
        }
        if (usage.termResults > 0) {
          parts.push(
            `${usage.termResults} term result${usage.termResults === 1 ? '' : 's'}`,
          );
        }
        // A descriptor that is a class's *failing* one has never been awarded
        // to anybody and is still load-bearing: archive it and that class
        // quietly loses its ability to hold a child back.
        if (usage.criteria > 0) {
          parts.push(
            `is the failing sub-category for ${usage.criteria} class${usage.criteria === 1 ? '' : 'es'}`,
          );
        }

        return apiFailure(
          'in_use',
          `"${existing.label}" ${usage.subjectResults + usage.termResults > 0 ? 'has been awarded on' : ''} ${parts.join(' and ')}. Archive it instead — it disappears from every picker and those results keep rendering exactly as they were issued.`
            .replace(/\s+/g, ' ')
            .trim(),
          409,
        );
      }

      await db
        .update(resultSubcategories)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(resultSubcategories.locationId, auth.locationId),
            eq(resultSubcategories.id, id),
          ),
        );

      return apiSuccess({ subcategoryId: id, archived: true, usage });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'exams.write' },
);
