import { and, eq } from 'drizzle-orm';

import { expenseCategories } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { isUuid, readBoolean, readString } from '@/lib/validation';

/**
 * PATCH /api/school/accounting/expense-categories/[categoryId]
 *
 * Renames and deactivates. The account a category posts to is deliberately not
 * editable: expenses already filed under it were posted to the old head, and
 * changing it here would make the category's name disagree with the entries it
 * produced. A school that wants a different head makes a new category and
 * deactivates this one, which leaves the history readable.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ categoryId: string }> };

interface PatchCategoryBody {
  name?: unknown;
  isActive?: unknown;
}

export const PATCH = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { categoryId } = await context.params;
      if (!isUuid(categoryId)) return apiFailure('not_found', 'Category not found.', 404);

      const [category] = await db
        .select({ id: expenseCategories.id, name: expenseCategories.name, isActive: expenseCategories.isActive })
        .from(expenseCategories)
        .where(
          and(
            eq(expenseCategories.id, categoryId),
            eq(expenseCategories.locationId, auth.locationId),
          ),
        )
        .limit(1);

      if (category === undefined) {
        return apiFailure('not_found', 'Category not found.', 404);
      }

      const body = await readJsonBody<PatchCategoryBody>(request);
      if (body === null) return apiFailure('invalid_body', 'Expected a JSON body.', 400);

      const name = body.name === undefined ? category.name : readString(body.name);
      if (name === '') return apiFailure('invalid_body', 'Give the category a name.', 400);

      await db
        .update(expenseCategories)
        .set({
          name,
          isActive: readBoolean(body.isActive, category.isActive),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(expenseCategories.id, categoryId),
            eq(expenseCategories.locationId, auth.locationId),
          ),
        );

      return apiSuccess({ categoryId });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'accounting.write' },
);
