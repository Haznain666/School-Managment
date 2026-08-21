import { and, eq } from 'drizzle-orm';

import { ledgerAccounts } from '@/db/schema';
import { isAccountCode, isLedgerAccountType } from '@/lib/accounting';
import { listLedgerAccounts, seedChartOfAccounts } from '@/lib/accounting-queries';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { isUuid, readOptionalString, readString } from '@/lib/validation';

/**
 * /api/school/accounting/accounts — the chart of accounts.
 *
 * GET  every head, in code order, with the campus and owner resolved
 * POST add one
 *
 * ── What a school may not do here ────────────────────────────────────────
 * It may not set `system_key`. That column is how the code finds the account a
 * fee payment lands in, and a school that could point `fee_income` at its
 * petty cash would produce books that balance and say nothing true. It is set
 * by the seed and by the staff-cash-account route, and by nothing that reads a
 * request body.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const activeOnly = new URL(request.url).searchParams.get('active') === 'true';
      return apiSuccess({
        accounts: await listLedgerAccounts(auth.locationId, { activeOnly }),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'accounting.read' },
);

interface CreateAccountBody {
  code?: unknown;
  name?: unknown;
  type?: unknown;
  description?: unknown;
  branchId?: unknown;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<CreateAccountBody>(request);
      if (body === null) return apiFailure('invalid_body', 'Expected a JSON body.', 400);

      const name = readString(body.name);
      if (name === '') {
        return apiFailure('invalid_body', 'Give the account a name.', 400);
      }

      if (!isLedgerAccountType(body.type)) {
        return apiFailure(
          'invalid_body',
          'Choose whether this is an asset, a liability, equity, income or an expense.',
          400,
        );
      }

      if (!isAccountCode(body.code)) {
        return apiFailure(
          'invalid_body',
          'An account code is three to eight digits — 5600, for example.',
          400,
        );
      }

      const branchId = readOptionalString(body.branchId);
      if (branchId !== null && !isUuid(branchId)) {
        return apiFailure('invalid_body', 'That campus could not be found.', 400);
      }

      const [existing] = await db
        .select({ id: ledgerAccounts.id })
        .from(ledgerAccounts)
        .where(
          and(
            eq(ledgerAccounts.locationId, auth.locationId),
            eq(ledgerAccounts.code, body.code),
          ),
        )
        .limit(1);

      if (existing !== undefined) {
        return apiFailure(
          'code_taken',
          `Account code ${body.code} is already in use. Codes have to be unique so the chart sorts.`,
          409,
        );
      }

      const [created] = await db
        .insert(ledgerAccounts)
        .values({
          locationId: auth.locationId,
          code: body.code,
          name,
          type: body.type,
          description: readOptionalString(body.description),
          branchId,
        })
        .returning({ id: ledgerAccounts.id });

      return apiSuccess({ accountId: created?.id ?? null }, 201);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'accounting.write' },
);

/**
 * PUT /api/school/accounting/accounts — set up a school that has none.
 *
 * Idempotent, and deliberately on this route rather than a `/seed` child of
 * it: seeding *is* creating the chart, and a school that already has one gets
 * a response saying nothing was new rather than an error.
 */
export const PUT = withSchoolAuth(
  async (_request, auth) => {
    try {
      const result = await seedChartOfAccounts(auth.locationId);
      return apiSuccess({
        ...result,
        accounts: await listLedgerAccounts(auth.locationId),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'accounting.write' },
);
