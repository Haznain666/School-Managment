import { and, eq } from 'drizzle-orm';

import { expenseCategories, ledgerAccounts } from '@/db/schema';
import { listExpenseCategories } from '@/lib/accounting-queries';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { isUuid, readString } from '@/lib/validation';

/**
 * /api/school/accounting/expense-categories
 *
 * A category is the word a clerk picks from; the account it points at is where
 * the money lands. Two categories may point at one head — "Van Fuel" and "Van
 * Repairs" are both Transport & Fuel — which is the whole reason this is a
 * reference and not a name copied out of the chart.
 *
 * The account must be an expense account. Filing a bill under Fee Income would
 * produce a balanced transaction and a profit and loss that reads as though
 * paying the electricity bill earned the school money.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (_request, auth) => {
    try {
      return apiSuccess({ categories: await listExpenseCategories(auth.locationId) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'accounting.read' },
);

interface CategoryBody {
  name?: unknown;
  ledgerAccountId?: unknown;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<CategoryBody>(request);
      if (body === null) return apiFailure('invalid_body', 'Expected a JSON body.', 400);

      const name = readString(body.name);
      if (name === '') return apiFailure('invalid_body', 'Give the category a name.', 400);

      if (!isUuid(body.ledgerAccountId)) {
        return apiFailure('invalid_body', 'Choose the account this posts to.', 400);
      }

      const [account] = await db
        .select({ id: ledgerAccounts.id, type: ledgerAccounts.type })
        .from(ledgerAccounts)
        .where(
          and(
            eq(ledgerAccounts.id, body.ledgerAccountId),
            eq(ledgerAccounts.locationId, auth.locationId),
          ),
        )
        .limit(1);

      if (account === undefined) {
        return apiFailure('not_found', 'That account could not be found.', 404);
      }

      if (account.type !== 'expense') {
        return apiFailure(
          'wrong_account_type',
          'An expense category has to post to an expense account, or the profit and loss will read as though spending money earned it.',
          400,
        );
      }

      const [created] = await db
        .insert(expenseCategories)
        .values({
          locationId: auth.locationId,
          name,
          ledgerAccountId: body.ledgerAccountId,
        })
        .onConflictDoNothing()
        .returning({ id: expenseCategories.id });

      if (created === undefined) {
        return apiFailure(
          'name_taken',
          `There is already a category called ${name}.`,
          409,
        );
      }

      return apiSuccess({ categoryId: created.id }, 201);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'accounting.write' },
);
