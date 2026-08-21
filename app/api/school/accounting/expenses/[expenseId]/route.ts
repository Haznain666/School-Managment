import { and, eq } from 'drizzle-orm';

import { expenses } from '@/db/schema';
import { parsePositiveAmountPaise } from '@/lib/accounting';
import { getExpense } from '@/lib/accounting-queries';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { paiseToNumeric } from '@/lib/money';
import { isIsoDate, isUuid, readOptionalString } from '@/lib/validation';

/**
 * /api/school/accounting/expenses/[expenseId]
 *
 * GET    one expense
 * PATCH  correct a draft
 * DELETE discard a draft
 *
 * ── Both writes refuse anything that has been approved ───────────────────
 * This is the asymmetry the module is built on. A draft is a form somebody is
 * filling in; an approved expense is a description of a transaction that
 * exists, and a description that can be edited away from what it describes is
 * worse than none at all. Correcting an approved expense means reversing its
 * posting, which leaves both entries in the book and says who did it.
 *
 * A rejected one is also frozen: it is the record that somebody asked and was
 * refused, and editing it into a fresh request would erase the refusal.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ expenseId: string }> };

export const GET = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { expenseId } = await context.params;
      if (!isUuid(expenseId)) return apiFailure('not_found', 'Expense not found.', 404);

      const expense = await getExpense(auth.locationId, expenseId);
      if (expense === null) return apiFailure('not_found', 'Expense not found.', 404);

      return apiSuccess({ expense });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'accounting.read' },
);

interface PatchExpenseBody {
  amount?: unknown;
  expenseDate?: unknown;
  payee?: unknown;
  referenceNumber?: unknown;
  attachmentUrl?: unknown;
  notes?: unknown;
  categoryId?: unknown;
  paidFromAccountId?: unknown;
}

export const PATCH = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { expenseId } = await context.params;
      if (!isUuid(expenseId)) return apiFailure('not_found', 'Expense not found.', 404);

      const expense = await getExpense(auth.locationId, expenseId);
      if (expense === null) return apiFailure('not_found', 'Expense not found.', 404);

      if (expense.status !== 'draft') {
        return apiFailure(
          'expense_closed',
          expense.status === 'approved'
            ? 'This expense has been approved and the money has left the school. Reverse its ledger entry to correct it.'
            : 'This expense was rejected. Its record stays as it is — file a fresh one instead.',
          409,
        );
      }

      const body = await readJsonBody<PatchExpenseBody>(request);
      if (body === null) return apiFailure('invalid_body', 'Expected a JSON body.', 400);

      const amountPaise =
        body.amount === undefined
          ? expense.amountPaise
          : parsePositiveAmountPaise(body.amount);

      if (amountPaise === null) {
        return apiFailure('invalid_body', 'Enter an amount greater than zero.', 400);
      }

      const expenseDate =
        body.expenseDate === undefined ? expense.expenseDate : body.expenseDate;
      if (!isIsoDate(expenseDate)) {
        return apiFailure('invalid_body', 'Give the expense a date.', 400);
      }

      const categoryId =
        body.categoryId === undefined ? expense.categoryId : body.categoryId;
      if (!isUuid(categoryId)) {
        return apiFailure('invalid_body', 'Choose what this was spent on.', 400);
      }

      const paidFromAccountId =
        body.paidFromAccountId === undefined
          ? expense.paidFromAccountId
          : body.paidFromAccountId;
      if (!isUuid(paidFromAccountId)) {
        return apiFailure('invalid_body', 'Choose where the money came from.', 400);
      }

      await db
        .update(expenses)
        .set({
          amount: paiseToNumeric(amountPaise),
          expenseDate,
          categoryId,
          paidFromAccountId,
          payee: body.payee === undefined ? undefined : readOptionalString(body.payee),
          referenceNumber:
            body.referenceNumber === undefined
              ? undefined
              : readOptionalString(body.referenceNumber),
          attachmentUrl:
            body.attachmentUrl === undefined
              ? undefined
              : readOptionalString(body.attachmentUrl),
          notes: body.notes === undefined ? undefined : readOptionalString(body.notes),
          updatedAt: new Date(),
        })
        .where(
          and(eq(expenses.id, expenseId), eq(expenses.locationId, auth.locationId)),
        );

      return apiSuccess({ expenseId });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'accounting.write' },
);

export const DELETE = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { expenseId } = await context.params;
      if (!isUuid(expenseId)) return apiFailure('not_found', 'Expense not found.', 404);

      const expense = await getExpense(auth.locationId, expenseId);
      if (expense === null) return apiFailure('not_found', 'Expense not found.', 404);

      if (expense.status !== 'draft') {
        return apiFailure(
          'expense_closed',
          'Only a draft can be discarded. An expense that has been decided on is part of the record.',
          409,
        );
      }

      await db
        .delete(expenses)
        .where(and(eq(expenses.id, expenseId), eq(expenses.locationId, auth.locationId)));

      return apiSuccess({ expenseId, deleted: true });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'accounting.write' },
);
