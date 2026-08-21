import { and, eq } from 'drizzle-orm';

import { ledgerAccounts, schoolUsers } from '@/db/schema';
import { suggestAccountCode } from '@/lib/accounting';
import { listLedgerAccounts, listStaffCashAccounts } from '@/lib/accounting-queries';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { isUuid } from '@/lib/validation';

/**
 * /api/school/accounting/cash-accounts — a fee counter's own drawer.
 *
 * GET  every staff cash account and what its holder is carrying
 * POST open one for a member of staff
 *
 * ── What opening one changes ─────────────────────────────────────────────
 * From the moment this exists, cash that person takes at the fee counter lands
 * here instead of in office cash — `cashAccountForStaff` in `lib/ledger.ts` is
 * the whole of that behaviour, and the fee payment route does not know the
 * difference. Their balance is then what they owe the school until they settle
 * it.
 *
 * A school that never opens one behaves exactly as it did before this sprint,
 * which is the property that lets this ship without a school having to
 * understand it first.
 *
 * ── One per person, and it is not deleted ────────────────────────────────
 * A partial unique index enforces the first. The second is the ordinary rule
 * for accounts: this one has money in its history, so it deactivates through
 * the chart of accounts rather than disappearing.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (_request, auth) => {
    try {
      return apiSuccess({ accounts: await listStaffCashAccounts(auth.locationId) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'accounting.read' },
);

interface OpenCashAccountBody {
  staffUserId?: unknown;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<OpenCashAccountBody>(request);
      if (body === null) return apiFailure('invalid_body', 'Expected a JSON body.', 400);

      if (!isUuid(body.staffUserId)) {
        return apiFailure('invalid_body', 'Choose whose account this is.', 400);
      }

      const [member] = await db
        .select({ id: schoolUsers.id, name: schoolUsers.name, isActive: schoolUsers.isActive })
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

      if (!member.isActive) {
        return apiFailure(
          'inactive_member',
          `${member.name}'s account has been deactivated, so they cannot be given a cash drawer.`,
          409,
        );
      }

      const [existing] = await db
        .select({ id: ledgerAccounts.id })
        .from(ledgerAccounts)
        .where(
          and(
            eq(ledgerAccounts.locationId, auth.locationId),
            eq(ledgerAccounts.ownerUserId, body.staffUserId),
          ),
        )
        .limit(1);

      if (existing !== undefined) {
        return apiFailure(
          'already_open',
          `${member.name} already has a cash account. One person, one drawer — two would split their takings across a pair of balances and neither would be their position.`,
          409,
        );
      }

      const chart = await listLedgerAccounts(auth.locationId);
      const code = suggestAccountCode(
        'asset',
        chart.map((account) => account.code),
      );

      const [created] = await db
        .insert(ledgerAccounts)
        .values({
          locationId: auth.locationId,
          code,
          name: `Cash — ${member.name}`,
          type: 'asset',
          description:
            'Money this member of staff has taken and not yet handed to the office.',
          ownerUserId: member.id,
        })
        .returning({ id: ledgerAccounts.id });

      return apiSuccess({ accountId: created?.id ?? null, code }, 201);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'accounting.settle' },
);
