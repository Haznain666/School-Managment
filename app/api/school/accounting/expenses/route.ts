import { and, eq } from 'drizzle-orm';

import { expenseCategories, expenses, ledgerAccounts } from '@/db/schema';
import { isExpenseStatus, parsePositiveAmountPaise } from '@/lib/accounting';
import { listExpenses } from '@/lib/accounting-queries';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { paiseToNumeric } from '@/lib/money';
import { isIsoDate, isUuid, readOptionalString } from '@/lib/validation';

/**
 * /api/school/accounting/expenses
 *
 * GET  the expense register, filtered
 * POST file one
 *
 * ── Filing is not paying ─────────────────────────────────────────────────
 * A `POST` here writes a draft and posts nothing. The money leaves the school
 * when somebody approves it, on `…/[expenseId]/decision`, and that is a
 * separate permission on purpose: whoever fills the form in is rarely whoever
 * the school would hold answerable for the figure.
 *
 * ── Both accounts are checked, and checked as the right kind ─────────────
 * The category's head must be an expense account (enforced when the category
 * is created) and the account the money came out of must be an asset. Paying
 * an electricity bill "out of" Fee Income would balance and would be nonsense,
 * and nothing downstream would object — a profit and loss cannot tell you that
 * one of its own inputs was absurd.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const search = new URL(request.url).searchParams;
      const from = search.get('from');
      const to = search.get('to');
      const status = search.get('status');
      const categoryId = search.get('categoryId');

      return apiSuccess({
        expenses: await listExpenses(auth.locationId, {
          from: isIsoDate(from) ? from : undefined,
          to: isIsoDate(to) ? to : undefined,
          status: isExpenseStatus(status) ? status : undefined,
          categoryId: isUuid(categoryId) ? categoryId : undefined,
        }),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'accounting.read' },
);

interface CreateExpenseBody {
  categoryId?: unknown;
  paidFromAccountId?: unknown;
  amount?: unknown;
  expenseDate?: unknown;
  payee?: unknown;
  referenceNumber?: unknown;
  attachmentUrl?: unknown;
  notes?: unknown;
  branchId?: unknown;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<CreateExpenseBody>(request);
      if (body === null) return apiFailure('invalid_body', 'Expected a JSON body.', 400);

      const amountPaise = parsePositiveAmountPaise(body.amount);
      if (amountPaise === null) {
        return apiFailure('invalid_body', 'Enter an amount greater than zero.', 400);
      }

      if (!isIsoDate(body.expenseDate)) {
        return apiFailure('invalid_body', 'Give the expense a date.', 400);
      }

      if (!isUuid(body.categoryId)) {
        return apiFailure('invalid_body', 'Choose what this was spent on.', 400);
      }

      if (!isUuid(body.paidFromAccountId)) {
        return apiFailure('invalid_body', 'Choose where the money came from.', 400);
      }

      const [category] = await db
        .select({ id: expenseCategories.id, isActive: expenseCategories.isActive })
        .from(expenseCategories)
        .where(
          and(
            eq(expenseCategories.id, body.categoryId),
            eq(expenseCategories.locationId, auth.locationId),
          ),
        )
        .limit(1);

      if (category === undefined) {
        return apiFailure('not_found', 'That category could not be found.', 404);
      }

      if (!category.isActive) {
        return apiFailure(
          'category_inactive',
          'That category has been switched off. Pick another one.',
          409,
        );
      }

      const [paidFrom] = await db
        .select({
          id: ledgerAccounts.id,
          name: ledgerAccounts.name,
          type: ledgerAccounts.type,
          isActive: ledgerAccounts.isActive,
        })
        .from(ledgerAccounts)
        .where(
          and(
            eq(ledgerAccounts.id, body.paidFromAccountId),
            eq(ledgerAccounts.locationId, auth.locationId),
          ),
        )
        .limit(1);

      if (paidFrom === undefined) {
        return apiFailure('not_found', 'That account could not be found.', 404);
      }

      if (paidFrom.type !== 'asset' && paidFrom.type !== 'liability') {
        return apiFailure(
          'wrong_account_type',
          `Money comes out of something the school holds or owes. ${paidFrom.name} is neither.`,
          400,
        );
      }

      const branchId = readOptionalString(body.branchId);
      if (branchId !== null && !isUuid(branchId)) {
        return apiFailure('invalid_body', 'That campus could not be found.', 400);
      }

      const [created] = await db
        .insert(expenses)
        .values({
          locationId: auth.locationId,
          branchId,
          categoryId: body.categoryId,
          paidFromAccountId: body.paidFromAccountId,
          amount: paiseToNumeric(amountPaise),
          expenseDate: body.expenseDate,
          payee: readOptionalString(body.payee),
          referenceNumber: readOptionalString(body.referenceNumber),
          attachmentUrl: readOptionalString(body.attachmentUrl),
          notes: readOptionalString(body.notes),
          status: 'draft',
          createdByUid: auth.uid,
        })
        .returning({ id: expenses.id });

      return apiSuccess({ expenseId: created?.id ?? null }, 201);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'accounting.write' },
);
