import {
  isLedgerSource,
  isManualSource,
  parsePositiveAmountPaise,
  type LedgerLineInput,
} from '@/lib/accounting';
import { listDayBook } from '@/lib/accounting-queries';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { LedgerError, postTransaction } from '@/lib/ledger';
import { isIsoDate, isUuid, readOptionalString, readString } from '@/lib/validation';

/**
 * /api/school/accounting/entries — the day book, and hand-written entries.
 *
 * GET  every transaction in a window, with its lines
 * POST post one by hand
 *
 * ── A hand-written entry may not claim to be something else ──────────────
 * `source` is checked against `MANUAL_SOURCES` — `manual` or `opening_balance`
 * and nothing more. A body claiming `fee_payment` would put an entry in the
 * fee reconciliation beside real ones with nothing to tell them apart, and the
 * reconciliation is the thing an accountant trusts when the fee module and the
 * bank disagree.
 *
 * ── There is no PATCH and no DELETE, at any URL ──────────────────────────
 * That is the module's one rule. A wrong entry is corrected by
 * `POST …/[transactionId]/reverse`, which writes a mirror and leaves both in
 * the book. See `db/schema/ledger-entries.ts` for why.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const search = new URL(request.url).searchParams;
      const from = search.get('from');
      const to = search.get('to');
      const source = search.get('source');
      const accountId = search.get('accountId');

      return apiSuccess({
        entries: await listDayBook(auth.locationId, {
          from: isIsoDate(from) ? from : undefined,
          to: isIsoDate(to) ? to : undefined,
          source: isLedgerSource(source) ? source : undefined,
          accountId: isUuid(accountId) ? accountId : undefined,
        }),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'accounting.read' },
);

interface EntryLineBody {
  accountId?: unknown;
  debit?: unknown;
  credit?: unknown;
  memo?: unknown;
}

interface CreateEntryBody {
  entryDate?: unknown;
  memo?: unknown;
  source?: unknown;
  referenceNumber?: unknown;
  branchId?: unknown;
  lines?: unknown;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<CreateEntryBody>(request);
      if (body === null) return apiFailure('invalid_body', 'Expected a JSON body.', 400);

      if (!isIsoDate(body.entryDate)) {
        return apiFailure('invalid_body', 'Give the entry a date.', 400);
      }

      const memo = readString(body.memo);
      if (memo === '') {
        return apiFailure(
          'invalid_body',
          'Say what this entry is for. It is the only thing that will explain it in six months.',
          400,
        );
      }

      const source = body.source === undefined ? 'manual' : body.source;
      if (!isManualSource(source)) {
        return apiFailure(
          'invalid_body',
          'A hand-written entry is a journal entry or an opening balance. Everything else is posted by the part of the software that raised it.',
          400,
        );
      }

      if (!Array.isArray(body.lines)) {
        return apiFailure('invalid_body', 'An entry needs at least two lines.', 400);
      }

      const lines: LedgerLineInput[] = [];
      for (const raw of body.lines as EntryLineBody[]) {
        if (!isUuid(raw.accountId)) {
          return apiFailure('invalid_body', 'Every line needs an account.', 400);
        }

        // A blank box is zero, not a refusal: one side of every line is empty
        // by definition, and making the form send `0` for it would be a rule
        // the person filling it in has to know about.
        const debitPaise = raw.debit === undefined || raw.debit === null || raw.debit === ''
          ? 0
          : parsePositiveAmountPaise(raw.debit);
        const creditPaise = raw.credit === undefined || raw.credit === null || raw.credit === ''
          ? 0
          : parsePositiveAmountPaise(raw.credit);

        if (debitPaise === null || creditPaise === null) {
          return apiFailure(
            'invalid_body',
            'An amount is a number of rupees, to at most two decimal places.',
            400,
          );
        }

        lines.push({
          accountId: raw.accountId,
          debitPaise,
          creditPaise,
          memo: readOptionalString(raw.memo),
        });
      }

      const branchId = readOptionalString(body.branchId);
      if (branchId !== null && !isUuid(branchId)) {
        return apiFailure('invalid_body', 'That campus could not be found.', 400);
      }

      const transactionId = await db.transaction(async (tx) =>
        postTransaction(tx, {
          locationId: auth.locationId,
          branchId,
          entryDate: body.entryDate as string,
          memo,
          source,
          referenceNumber: readOptionalString(body.referenceNumber),
          createdByUid: auth.uid,
          lines,
        }),
      );

      return apiSuccess({ transactionId }, 201);
    } catch (error) {
      // The balance check and the tenancy check on the accounts both come back
      // as this, and both are the caller's mistake rather than a fault.
      if (error instanceof LedgerError) {
        return apiFailure('unbalanced', error.message, 400);
      }
      return handleApiError(error);
    }
  },
  { permission: 'accounting.write' },
);
