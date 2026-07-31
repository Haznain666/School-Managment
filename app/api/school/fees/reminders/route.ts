import { eq } from 'drizzle-orm';

import { schools } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { getChallanDetail, listDefaulters } from '@/lib/fee-queries';
import { FEE_WRITE_ROLES } from '@/lib/fee-roles';
import { sendBulkFeeReminders, type BulkReminderTarget } from '@/lib/ghl-fees';
import { formatPkr } from '@/lib/money';
import { isUuid } from '@/lib/validation';

/**
 * POST /api/school/fees/reminders — WhatsApp a family about an unpaid challan.
 *
 * Two shapes: a list of challan ids, or `{ all: true }` with filters, which
 * reminds everyone on the defaulters list.
 *
 * ── On honesty about delivery ────────────────────────────────────────────
 * Sends are attempted here rather than fired and forgotten, and the response
 * reports how many actually landed. Returning a cheerful "200 reminders queued"
 * when GHL was down would leave a school believing it had chased its
 * defaulters when it had not — worse than telling it plainly that nothing went
 * out.
 *
 * Individual failures never fail the request: `sendBulkFeeReminders` catches
 * per target and counts, so one bad phone number does not stop the other
 * hundred and ninety-nine.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Guards the request against becoming a long-running send. */
const MAX_TARGETS = 200;

interface RemindersBody {
  challanIds?: unknown;
  all?: unknown;
  filters?: { minDaysOverdue?: unknown } | undefined;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<RemindersBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const schoolRows = await db
        .select({ name: schools.name })
        .from(schools)
        .where(eq(schools.locationId, auth.locationId))
        .limit(1);

      const schoolName = schoolRows[0]?.name ?? 'your school';

      const targets: BulkReminderTarget[] = [];
      let skippedNoPhone = 0;

      if (body.all === true) {
        const raw = Number(body.filters?.minDaysOverdue ?? 30);
        const minDaysOverdue = Number.isInteger(raw) && raw >= 0 ? raw : 30;

        const defaulters = await listDefaulters(auth.locationId, minDaysOverdue);

        for (const row of defaulters.slice(0, MAX_TARGETS)) {
          if (row.guardianPhone === null) {
            skippedNoPhone += 1;
            continue;
          }

          targets.push({
            challanId: row.id,
            guardianPhone: row.guardianPhone,
            // The register does not carry the guardian's name; the student's
            // is what the family will recognise on the message anyway.
            guardianName: 'Parent',
            studentName: row.studentName,
            challanNumber: row.challanNumber,
            dueDate: row.dueDate,
            amount: formatPkr(row.balancePaise),
            schoolName,
          });
        }
      } else {
        if (!Array.isArray(body.challanIds) || body.challanIds.length === 0) {
          return apiFailure(
            'invalid_body',
            'Pass challanIds, or all: true with filters.',
            400,
          );
        }

        if (body.challanIds.length > MAX_TARGETS) {
          return apiFailure(
            'too_many',
            `Send at most ${MAX_TARGETS} reminders at a time.`,
            400,
          );
        }

        for (const raw of body.challanIds) {
          if (typeof raw !== 'string' || !isUuid(raw)) continue;

          // Each challan is loaded through the tenant-scoped read, so an id
          // from another school resolves to nothing rather than to a message.
          const challan = await getChallanDetail(auth.locationId, raw);
          if (challan === null) continue;

          if (challan.guardianPhone === null || challan.guardianName === null) {
            skippedNoPhone += 1;
            continue;
          }

          targets.push({
            challanId: challan.id,
            guardianPhone: challan.guardianPhone,
            guardianName: challan.guardianName,
            studentName: challan.studentName,
            challanNumber: challan.challanNumber,
            dueDate: challan.dueDate,
            amount: formatPkr(challan.balancePaise),
            schoolName,
          });
        }
      }

      if (targets.length === 0) {
        return apiSuccess({ queued: 0, failed: 0, skippedNoPhone });
      }

      const result = await sendBulkFeeReminders(db, auth.locationId, targets);

      return apiSuccess({ ...result, skippedNoPhone });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: FEE_WRITE_ROLES },
);
