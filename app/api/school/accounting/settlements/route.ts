import { and, eq } from 'drizzle-orm';

import { cashSettlements, ledgerAccounts, schoolUsers } from '@/db/schema';
import { parsePositiveAmountPaise, twoSidedLines } from '@/lib/accounting';
import {
  getAccountBalance,
  listSettlements,
  listStaffCashAccounts,
} from '@/lib/accounting-queries';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { LedgerError, loadSystemAccounts, postTransaction, requireSystemAccount } from '@/lib/ledger';
import { formatPkr, paiseToNumeric } from '@/lib/money';
import { isIsoDate, isUuid, readOptionalString } from '@/lib/validation';

/**
 * /api/school/accounting/settlements — the counter hands its takings in.
 *
 * GET  what has been settled, and by whom
 * POST record one
 *
 * ── The two numbers, and why both are stored ─────────────────────────────
 * `expectedAmount` is what the clerk's account held at the moment of settling;
 * `amount` is what was actually counted onto the desk. They differ when the
 * drawer is short or over.
 *
 * The difference is **not** written off. It stays in the clerk's account as a
 * balance they still carry, which is what makes "short by 500" a fact somebody
 * has to resolve rather than a rounding the form absorbed at four in the
 * afternoon. Writing it off is a decision a head teacher makes with a journal
 * entry, in the open, against a named account.
 *
 * ── `accounting.settle`, not `accounting.write` ──────────────────────────
 * A person who takes money across a desk and also accepts their own count is a
 * control with nobody in it. The accountant role holds `write` and not
 * `settle` by default for exactly that reason — see `lib/permissions.ts`.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const search = new URL(request.url).searchParams;
      const from = search.get('from');
      const to = search.get('to');
      const staffUserId = search.get('staffUserId');

      return apiSuccess({
        settlements: await listSettlements(auth.locationId, {
          from: isIsoDate(from) ? from : undefined,
          to: isIsoDate(to) ? to : undefined,
          staffUserId: isUuid(staffUserId) ? staffUserId : undefined,
        }),
        accounts: await listStaffCashAccounts(auth.locationId),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'accounting.read' },
);

interface SettleBody {
  staffUserId?: unknown;
  amount?: unknown;
  settlementDate?: unknown;
  toAccountId?: unknown;
  referenceNumber?: unknown;
  notes?: unknown;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<SettleBody>(request);
      if (body === null) return apiFailure('invalid_body', 'Expected a JSON body.', 400);

      if (!isUuid(body.staffUserId)) {
        return apiFailure('invalid_body', 'Choose whose takings these are.', 400);
      }

      const amountPaise = parsePositiveAmountPaise(body.amount);
      if (amountPaise === null) {
        return apiFailure('invalid_body', 'Enter the amount handed over.', 400);
      }

      const settlementDate = isIsoDate(body.settlementDate)
        ? body.settlementDate
        : new Date().toISOString().slice(0, 10);

      const [member] = await db
        .select({ id: schoolUsers.id, name: schoolUsers.name })
        .from(schoolUsers)
        .where(
          and(
            eq(schoolUsers.id, body.staffUserId),
            eq(schoolUsers.locationId, auth.locationId),
          ),
        )
        .limit(1);

      if (member === undefined) {
        return apiFailure('not_found', 'That member of staff could not be found.', 404);
      }

      const [from] = await db
        .select({ id: ledgerAccounts.id, name: ledgerAccounts.name })
        .from(ledgerAccounts)
        .where(
          and(
            eq(ledgerAccounts.locationId, auth.locationId),
            eq(ledgerAccounts.ownerUserId, member.id),
          ),
        )
        .limit(1);

      if (from === undefined) {
        return apiFailure(
          'no_cash_account',
          `${member.name} has no cash account, so there is nothing to settle. Open one first.`,
          409,
        );
      }

      const systemAccounts = await loadSystemAccounts(auth.locationId);

      // Straight into the bank is a real Friday afternoon: the clerk walks the
      // takings to the branch rather than to the office safe. Either
      // destination is allowed; the default is the office drawer.
      const toAccountId = readOptionalString(body.toAccountId);
      let destination;
      if (toAccountId === null) {
        destination = requireSystemAccount(systemAccounts, 'cash_in_hand', 'Cash in Hand');
      } else {
        if (!isUuid(toAccountId)) {
          return apiFailure('invalid_body', 'That account could not be found.', 400);
        }
        const [chosen] = await db
          .select({ id: ledgerAccounts.id, name: ledgerAccounts.name, type: ledgerAccounts.type })
          .from(ledgerAccounts)
          .where(
            and(
              eq(ledgerAccounts.id, toAccountId),
              eq(ledgerAccounts.locationId, auth.locationId),
            ),
          )
          .limit(1);

        if (chosen === undefined) {
          return apiFailure('not_found', 'That account could not be found.', 404);
        }
        if (chosen.type !== 'asset') {
          return apiFailure(
            'wrong_account_type',
            `Takings are handed to something the school holds. ${chosen.name} is not.`,
            400,
          );
        }
        destination = chosen;
      }

      if (destination.id === from.id) {
        return apiFailure(
          'same_account',
          'Handing the money to the drawer it is already in moves nothing.',
          400,
        );
      }

      const settled = await db.transaction(async (tx) => {
        // The drawer's own row, locked. Two bursars settling the same clerk at
        // the same moment would otherwise each read the same balance and each
        // accept the whole of it, leaving the drawer in credit by a day's
        // takings. The lock is on the account rather than the entries because
        // the entries are append-only: there is no row there to hold.
        await tx
          .select({ id: ledgerAccounts.id })
          .from(ledgerAccounts)
          .where(eq(ledgerAccounts.id, from.id))
          .limit(1)
          .for('update');

        const expectedPaise = await getAccountBalance(auth.locationId, from.id, {}, tx);

        if (amountPaise > expectedPaise) {
          return { overSettled: true as const, expectedPaise };
        }

        // Debit where the money went, credit the drawer it left. What stays
        // behind, if anything, is what the clerk is still carrying — the short
        // is not written off here, deliberately.
        const transactionId = await postTransaction(tx, {
          locationId: auth.locationId,
          entryDate: settlementDate,
          memo: `Cash settled by ${member.name}`,
          source: 'settlement',
          referenceNumber: readOptionalString(body.referenceNumber),
          createdByUid: auth.uid,
          lines: twoSidedLines(destination.id, from.id, amountPaise),
        });

        const [created] = await tx
          .insert(cashSettlements)
          .values({
            locationId: auth.locationId,
            staffUserId: member.id,
            fromAccountId: from.id,
            toAccountId: destination.id,
            amount: paiseToNumeric(amountPaise),
            expectedAmount: paiseToNumeric(expectedPaise),
            settlementDate,
            receivedByUid: auth.uid,
            referenceNumber: readOptionalString(body.referenceNumber),
            notes: readOptionalString(body.notes),
            ledgerTransactionId: transactionId,
          })
          .returning({ id: cashSettlements.id });

        // The settlement row and its posting are written in one transaction or
        // neither is. A posting with no settlement would move the money with
        // nothing recording who counted it.
        return {
          overSettled: false as const,
          settlementId: created?.id ?? null,
          expectedPaise,
        };
      });

      if (settled.overSettled) {
        return apiFailure(
          'over_settlement',
          `${member.name} is only holding ${formatPkr(settled.expectedPaise / 100)}. Handing over more than that would leave their drawer in credit, which is not a state a drawer can be in — post a journal entry if the extra is genuinely the school's.`,
          409,
        );
      }

      return apiSuccess(
        {
          settlementId: settled.settlementId,
          expected: paiseToNumeric(settled.expectedPaise),
          handedOver: paiseToNumeric(amountPaise),
          stillHolding: paiseToNumeric(settled.expectedPaise - amountPaise),
        },
        201,
      );
    } catch (error) {
      if (error instanceof LedgerError) {
        return apiFailure('cannot_post', error.message, 409);
      }
      return handleApiError(error);
    }
  },
  { permission: 'accounting.settle' },
);
