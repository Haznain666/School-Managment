import { and, eq } from 'drizzle-orm';

import { expenseCategories, expenses } from '@/db/schema';
import { twoSidedLines } from '@/lib/accounting';
import { getExpense, schoolUserIdForUid } from '@/lib/accounting-queries';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { LedgerError, postTransaction } from '@/lib/ledger';
import { formatPkr, toPaise } from '@/lib/money';
import { isUuid, readString } from '@/lib/validation';

/**
 * POST /api/school/accounting/expenses/[expenseId]/decision
 *
 * Approves or rejects a draft. Approving is what moves the money, and it is
 * the single most consequential write in this module.
 *
 * ── The claim, and why it is not a read followed by an `if` ──────────────
 * Production runs **seven** server processes (`CLAUDE.md`, STATE.md), and two
 * people can press Approve on the same expense within the same second. A
 * read-then-check would let both pass and the expense would post twice: the
 * school's books would show 40,000 leaving for one 20,000 bill, and nothing
 * would report an error, because both transactions balance perfectly.
 *
 * The read inside the transaction below is therefore `SELECT … FOR UPDATE`.
 * The second caller blocks on the row until the first commits, and then reads
 * a row whose status is `approved` — so it refuses rather than posting a
 * duplicate. A conditional `UPDATE … RETURNING` would also serialise it, and
 * is what `CLAUDE.md` calls for when there is no row to hold; here there is
 * one, and holding it lets the amount and the category be read under the same
 * lock they are posted under. Nothing can edit the draft out from under the
 * posting.
 *
 * ── One transaction, so a failure leaves a draft rather than a lie ───────
 * The lock, the posting and the write of `ledger_transaction_id` are one
 * database transaction. A throw anywhere in it — a chart with no cash account,
 * an unbalanced line — rolls all of it back, so what is left is a draft that
 * can be approved again rather than an expense that says "approved" and posted
 * nothing. `expenses_posting_check` is the backstop: the row cannot be
 * `approved` with a null posting even if this code were wrong.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ expenseId: string }> };

interface DecisionBody {
  decision?: unknown;
  reason?: unknown;
}

export const POST = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { expenseId } = await context.params;
      if (!isUuid(expenseId)) return apiFailure('not_found', 'Expense not found.', 404);

      const body = await readJsonBody<DecisionBody>(request);
      if (body === null) return apiFailure('invalid_body', 'Expected a JSON body.', 400);

      const decision = readString(body.decision);
      if (decision !== 'approve' && decision !== 'reject') {
        return apiFailure('invalid_body', 'Approve it or reject it.', 400);
      }

      const expense = await getExpense(auth.locationId, expenseId);
      if (expense === null) return apiFailure('not_found', 'Expense not found.', 404);

      if (expense.status !== 'draft') {
        return apiFailure(
          'already_decided',
          `This expense has already been ${expense.status === 'approved' ? 'approved' : 'rejected'}.`,
          409,
        );
      }

      const approverId = await schoolUserIdForUid(auth.locationId, auth.uid);

      if (decision === 'reject') {
        const reason = readString(body.reason);
        if (reason === '') {
          return apiFailure(
            'invalid_body',
            'Say why. Whoever filed this needs to know what to change.',
            400,
          );
        }

        // The same conditional claim, for the same reason: two people
        // rejecting at once would each write their own reason, and the second
        // would erase the first.
        const claimed = await db
          .update(expenses)
          .set({
            status: 'rejected',
            rejectionReason: reason,
            approvedBy: approverId,
            approvedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(expenses.id, expenseId),
              eq(expenses.locationId, auth.locationId),
              eq(expenses.status, 'draft'),
            ),
          )
          .returning({ id: expenses.id });

        if (claimed.length === 0) {
          return apiFailure(
            'already_decided',
            'Somebody else decided this one first.',
            409,
          );
        }

        return apiSuccess({ expenseId, status: 'rejected' });
      }

      const result = await db.transaction(async (tx) => {
        const [row] = await tx
          .select({
            id: expenses.id,
            amount: expenses.amount,
            status: expenses.status,
            expenseDate: expenses.expenseDate,
            branchId: expenses.branchId,
            categoryId: expenses.categoryId,
            paidFromAccountId: expenses.paidFromAccountId,
            payee: expenses.payee,
            referenceNumber: expenses.referenceNumber,
          })
          .from(expenses)
          .where(
            and(eq(expenses.id, expenseId), eq(expenses.locationId, auth.locationId)),
          )
          .limit(1)
          // The lock. Everything below reads and posts the row nobody else can
          // touch until this transaction commits.
          .for('update');

        // Not the same check as the one above the transaction: that one is a
        // courtesy that answers quickly, this one is the truth, read under the
        // lock after any competing approval has committed.
        if (row === undefined || row.status !== 'draft') return null;

        const [category] = await tx
          .select({
            name: expenseCategories.name,
            ledgerAccountId: expenseCategories.ledgerAccountId,
          })
          .from(expenseCategories)
          .where(
            and(
              eq(expenseCategories.id, row.categoryId),
              eq(expenseCategories.locationId, auth.locationId),
            ),
          )
          .limit(1);

        if (category === undefined) {
          throw new LedgerError('That expense category could not be found.');
        }

        // Debit what it was spent on, credit where the money came from.
        const transactionId = await postTransaction(tx, {
          locationId: auth.locationId,
          branchId: row.branchId,
          entryDate: row.expenseDate,
          memo:
            row.payee === null || row.payee === ''
              ? category.name
              : `${category.name} — ${row.payee}`,
          source: 'expense',
          sourceId: row.id,
          referenceNumber: row.referenceNumber,
          createdByUid: auth.uid,
          // From the locked row, not from the read above it. They are the
          // same number unless somebody edited the draft in between, and if
          // they did, the edited one is the one being approved.
          lines: twoSidedLines(
            category.ledgerAccountId,
            row.paidFromAccountId,
            toPaise(row.amount),
          ),
        });

        await tx
          .update(expenses)
          .set({
            status: 'approved',
            ledgerTransactionId: transactionId,
            approvedBy: approverId,
            approvedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(eq(expenses.id, expenseId), eq(expenses.locationId, auth.locationId)),
          );

        return { transactionId, amountPaise: toPaise(row.amount) };
      });

      if (result === null) {
        return apiFailure('already_decided', 'Somebody else decided this one first.', 409);
      }

      return apiSuccess({
        expenseId,
        status: 'approved',
        transactionId: result.transactionId,
        posted: `${formatPkr(result.amountPaise / 100)} out of ${expense.paidFromName}`,
      });
    } catch (error) {
      if (error instanceof LedgerError) {
        return apiFailure('cannot_post', error.message, 409);
      }
      return handleApiError(error);
    }
  },
  { permission: 'accounting.write' },
);
