import { and, eq, inArray } from 'drizzle-orm';

import { feeChallans, schoolUsers, schools, studentProfiles } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { primaryGuardiansFor } from '@/lib/fee-queries';
import { canReachGuardian, sendFeeReminder } from '@/lib/fee-notices';
import { recordReminder } from '@/lib/fee-reminders';
import { toPaise } from '@/lib/money';
import { isUuid } from '@/lib/validation';

/**
 * POST /api/school/fees/reminders
 *
 * Emails an overdue-fee notice to the primary guardian of each named challan.
 *
 * ── On not blocking ──────────────────────────────────────────────────────
 * "Send all reminders" on a defaulters list of two hundred cannot be two
 * hundred awaited round trips to a mail host — the request would time out long
 * before the last message went. The sends are therefore fired and not awaited,
 * and the response reports how many were *queued*, which is the honest word for
 * what has happened by the time it returns.
 *
 * A message that fails is logged and dropped. Nothing here changes the challan,
 * so a school can simply send again.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Cap per request, so one click cannot queue an unbounded fan-out. */
const MAX_REMINDERS = 200;

interface RemindersBody {
  challanIds?: unknown;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<RemindersBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      if (!Array.isArray(body.challanIds) || body.challanIds.length === 0) {
        return apiFailure('invalid_body', 'Select at least one challan.', 400);
      }

      const challanIds = body.challanIds.filter(isUuid);
      if (challanIds.length === 0) {
        return apiFailure('invalid_body', 'Select at least one challan.', 400);
      }

      if (challanIds.length > MAX_REMINDERS) {
        return apiFailure(
          'too_many',
          `Send at most ${MAX_REMINDERS} reminders at a time.`,
          400,
        );
      }

      // Scoped to this school, so a challan id belonging to another tenant
      // simply is not found rather than being messaged about.
      const rows = await db
        .select({
          id: feeChallans.id,
          challanNumber: feeChallans.challanNumber,
          studentProfileId: feeChallans.studentProfileId,
          studentName: schoolUsers.name,
          dueDate: feeChallans.dueDate,
          totalAmount: feeChallans.totalAmount,
          paidAmount: feeChallans.paidAmount,
          status: feeChallans.status,
          schoolName: schools.name,
        })
        .from(feeChallans)
        .innerJoin(studentProfiles, eq(studentProfiles.id, feeChallans.studentProfileId))
        .innerJoin(schoolUsers, eq(schoolUsers.id, studentProfiles.schoolUserId))
        .innerJoin(schools, eq(schools.locationId, feeChallans.locationId))
        .where(
          and(
            eq(feeChallans.locationId, auth.locationId),
            inArray(feeChallans.id, challanIds),
          ),
        );

      const owing = rows.filter(
        (row) =>
          (row.status === 'unpaid' || row.status === 'partial') &&
          toPaise(row.totalAmount) - toPaise(row.paidAmount) > 0,
      );

      const guardians = await primaryGuardiansFor(
        auth.locationId,
        owing.map((row) => row.studentProfileId),
      );

      let queued = 0;
      let recorded = 0;
      let noGuardian = 0;
      let unreachable = 0;

      for (const row of owing) {
        const guardian = guardians.get(row.studentProfileId);
        if (guardian === undefined) {
          noGuardian += 1;
          continue;
        }

        // ── Why this is counted and returned ─────────────────────────────
        // Email is the only channel, so a guardian with no address on file
        // receives nothing at all. That is a supported state, not a bug — but
        // a school that sends three hundred reminders and reaches two hundred
        // and sixty parents needs to be told so at send time, not to discover
        // it when the fees do not arrive.
        if (!canReachGuardian(guardian)) {
          unreachable += 1;
          continue;
        }

        queued += 1;

        /*
         * The record that this family has been chased (item 6b).
         *
         * Awaited, unlike the send. It is one INSERT with the sequence computed
         * inside it, and the number it produces is what the chip on the
         * defaulters row says — so a response claiming three reminders while
         * the rows were still landing would be a screen that disagrees with
         * itself on refresh. `recordReminder` never throws.
         */
        const sequence = await recordReminder({
          locationId: auth.locationId,
          challanId: row.id,
          sentToEmail: guardian.email,
          sentByUid: auth.uid,
        });
        if (sequence !== null) recorded += 1;

        // Fired, not awaited: see the note at the top of this file.
        void sendFeeReminder(db, auth.locationId, {
          guardian,
          studentName: row.studentName,
          challanNumber: row.challanNumber,
          amountDue: (toPaise(row.totalAmount) - toPaise(row.paidAmount)) / 100,
          dueDate: row.dueDate,
          schoolName: row.schoolName,
        }).catch((error: unknown) => {
          console.warn('[fees] reminder could not be queued:', error);
        });
      }

      return apiSuccess({
        queued,
        recorded,
        skipped: rows.length - owing.length,
        noGuardian,
        unreachable,
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'fees.write' },
);
