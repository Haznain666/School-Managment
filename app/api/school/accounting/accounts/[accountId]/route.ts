import { and, eq, sql } from 'drizzle-orm';

import { ledgerAccounts, ledgerEntries } from '@/db/schema';
import { isAccountCode } from '@/lib/accounting';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { isUuid, readBoolean, readOptionalString, readString } from '@/lib/validation';

/**
 * PATCH /api/school/accounting/accounts/[accountId]
 *
 * Renames, re-codes, re-describes and deactivates. Nothing else.
 *
 * ── There is no DELETE, and there will not be one ────────────────────────
 * An account that has been posted to is part of the history of the school's
 * money: deleting it would take entries with it, or orphan them, and either
 * way a balance sheet that used to balance stops. An account that has *not*
 * been posted to could safely be deleted, and offering delete only for those
 * would mean a button that works on Tuesday and refuses on Wednesday for a
 * reason nobody can see from the screen.
 *
 * So it is deactivation, always, and the sentence on screen says what that
 * means: it disappears from the pickers and stays on the statements.
 *
 * ── A system account cannot be deactivated ───────────────────────────────
 * Deactivating `4000 Fee Income` would leave the next fee payment with nowhere
 * to post, and the clerk taking the money would be the person who found out.
 * Renaming and re-coding one is fine and expected — the code finds it by
 * `system_key`, which is not editable from here.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ accountId: string }> };

interface PatchAccountBody {
  code?: unknown;
  name?: unknown;
  description?: unknown;
  isActive?: unknown;
}

export const PATCH = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { accountId } = await context.params;
      if (!isUuid(accountId)) return apiFailure('not_found', 'Account not found.', 404);

      const [account] = await db
        .select({
          id: ledgerAccounts.id,
          code: ledgerAccounts.code,
          name: ledgerAccounts.name,
          systemKey: ledgerAccounts.systemKey,
          isActive: ledgerAccounts.isActive,
        })
        .from(ledgerAccounts)
        .where(
          and(
            eq(ledgerAccounts.id, accountId),
            eq(ledgerAccounts.locationId, auth.locationId),
          ),
        )
        .limit(1);

      if (account === undefined) {
        return apiFailure('not_found', 'Account not found.', 404);
      }

      const body = await readJsonBody<PatchAccountBody>(request);
      if (body === null) return apiFailure('invalid_body', 'Expected a JSON body.', 400);

      const isActive = readBoolean(body.isActive, account.isActive);

      if (!isActive && account.systemKey !== null) {
        return apiFailure(
          'system_account',
          `${account.name} is where this software posts automatically, so it cannot be switched off. Rename it if the wording is wrong.`,
          409,
        );
      }

      const name = body.name === undefined ? account.name : readString(body.name);
      if (name === '') {
        return apiFailure('invalid_body', 'Give the account a name.', 400);
      }

      const code = body.code === undefined ? account.code : body.code;
      if (!isAccountCode(code)) {
        return apiFailure(
          'invalid_body',
          'An account code is three to eight digits — 5600, for example.',
          400,
        );
      }

      if (code !== account.code) {
        const [clash] = await db
          .select({ id: ledgerAccounts.id })
          .from(ledgerAccounts)
          .where(
            and(
              eq(ledgerAccounts.locationId, auth.locationId),
              eq(ledgerAccounts.code, code),
            ),
          )
          .limit(1);

        if (clash !== undefined) {
          return apiFailure(
            'code_taken',
            `Account code ${code} is already in use.`,
            409,
          );
        }
      }

      await db
        .update(ledgerAccounts)
        .set({
          code,
          name,
          description:
            body.description === undefined
              ? undefined
              : readOptionalString(body.description),
          isActive,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(ledgerAccounts.id, accountId),
            eq(ledgerAccounts.locationId, auth.locationId),
          ),
        );

      const [entryCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(ledgerEntries)
        .where(eq(ledgerEntries.accountId, accountId));

      return apiSuccess({
        accountId,
        entryCount: entryCount?.count ?? 0,
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'accounting.write' },
);
