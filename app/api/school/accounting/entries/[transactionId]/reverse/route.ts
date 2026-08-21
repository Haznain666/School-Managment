import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { LedgerError, reverseTransaction } from '@/lib/ledger';
import { isIsoDate, isUuid, readString } from '@/lib/validation';

/**
 * POST /api/school/accounting/entries/[transactionId]/reverse
 *
 * The only correction this module has. It writes a second transaction whose
 * lines are the mirror of the first and leaves the first exactly where it is.
 *
 * ── The reason is required ───────────────────────────────────────────────
 * A reversal with no stated reason is two entries that cancel and nothing
 * saying why, which is the state a disputed balance is *worst* in: the money
 * is right and the story is missing. It goes into the new entry's memo, where
 * the day book prints it.
 *
 * ── It is dated today, not backdated ─────────────────────────────────────
 * `entryDate` may be given but the ledger refuses nothing about it here; the
 * caller sends today. Backdating a correction into a month somebody has
 * already read is how a closed month changes after the fact.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ transactionId: string }> };

interface ReverseBody {
  reason?: unknown;
  entryDate?: unknown;
}

export const POST = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { transactionId } = await context.params;
      if (!isUuid(transactionId)) {
        return apiFailure('not_found', 'That entry could not be found.', 404);
      }

      const body = await readJsonBody<ReverseBody>(request);
      if (body === null) return apiFailure('invalid_body', 'Expected a JSON body.', 400);

      const reason = readString(body.reason);
      if (reason === '') {
        return apiFailure(
          'invalid_body',
          'Say why this is being reversed. Two entries that cancel with no reason are the hardest thing to explain later.',
          400,
        );
      }

      const entryDate = isIsoDate(body.entryDate)
        ? body.entryDate
        : new Date().toISOString().slice(0, 10);

      const reversalId = await db.transaction(async (tx) =>
        reverseTransaction(tx, {
          locationId: auth.locationId,
          transactionId,
          entryDate,
          reason,
          createdByUid: auth.uid,
        }),
      );

      return apiSuccess({ reversalId, reversedTransactionId: transactionId }, 201);
    } catch (error) {
      if (error instanceof LedgerError) {
        return apiFailure('cannot_reverse', error.message, 409);
      }
      return handleApiError(error);
    }
  },
  { permission: 'accounting.write' },
);
