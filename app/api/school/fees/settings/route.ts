import { isLateFeeType, lateFeeRules } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { DEFAULT_AUTO_SEND_DAY } from '@/lib/voucher-auto-send';
import { DEFAULT_DUE_DAY, getLateFeeRule } from '@/lib/fee-queries';
import { paiseToNumeric, toPaise } from '@/lib/money';
import { readBoolean } from '@/lib/validation';

/**
 * /api/school/fees/settings
 *
 * GET   the school's late fee policy
 * PATCH create or replace it
 *
 * There is one row per school, so the write is an upsert on `location_id`
 * rather than a create-then-update dance the caller would have to sequence.
 *
 * Only a school admin may change it: a late fee policy decides what every
 * parent in the school is charged for being a day late, which is a level above
 * recording a payment.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (_request, auth) => {
    try {
      const rule = await getLateFeeRule(auth.locationId);

      // A school that has never configured a policy is not an error — it is
      // simply not charging late fees, which is the safe default.
      return apiSuccess({
        settings: rule ?? {
          dueDay: DEFAULT_DUE_DAY,
          autoSendVouchers: false,
          autoSendDay: DEFAULT_AUTO_SEND_DAY,
          isEnabled: false,
          graceDays: 0,
          lateFeeType: 'fixed' as const,
          lateFeeAmount: '0.00',
          maxLateFee: null,
          // Both off, matching the columns' own defaults. A school that has
          // never opened this screen is not discounting anybody's fees.
          autoApplySiblingDiscount: false,
          siblingDiscountForLastChild: false,
        },
        configured: rule !== null,
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'fees.read' },
);

interface UpdateSettingsBody {
  dueDay?: unknown;
  autoSendVouchers?: unknown;
  autoSendDay?: unknown;
  isEnabled?: unknown;
  graceDays?: unknown;
  lateFeeType?: unknown;
  lateFeeAmount?: unknown;
  maxLateFee?: unknown;
  autoApplySiblingDiscount?: unknown;
  siblingDiscountForLastChild?: unknown;
}

export const PATCH = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<UpdateSettingsBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      // Capped at 28 so that every month, February included, actually has the
      // day a school picked. A challan dated the 31st of February is not a bug
      // anyone should have to discover in production.
      const dueDay = Number(body.dueDay ?? DEFAULT_DUE_DAY);
      if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 28) {
        return apiFailure(
          'invalid_body',
          'The due day must be a whole number between 1 and 28.',
          400,
        );
      }

      const isEnabled = readBoolean(body.isEnabled, false);

      /*
       * Auto-send. Absent means off, and off is the only safe default.
       *
       * A sprint that deployed and began emailing every parent at a school
       * which never asked for it would be the worst thing this module could do,
       * and an email cannot be recalled. So the flag is read explicitly and a
       * body that does not mention it turns the feature off rather than
       * preserving whatever was there — this is a replace, not a merge, and the
       * form always sends both fields.
       */
      const autoSendVouchers = readBoolean(body.autoSendVouchers, false);

      /*
       * The two sibling-discount settings, read the same way and for the same
       * reason (Sprint 20, item 6). Absent means **off**: this is a replace,
       * not a merge, the form always sends both fields, and a body that does
       * not mention `autoApplySiblingDiscount` must not leave a school silently
       * discounting every new admission's fees.
       *
       * The asymmetric one is worth stating: `siblingDiscountForLastChild`
       * defaulting to false means the sweep *removes* a discount, which is a
       * fee rise on a parent's next voucher. That is the behaviour the
       * requirement describes — a discount for having siblings is not owed to a
       * child who has none — and a school that disagrees switches it on here.
       */
      const autoApplySiblingDiscount = readBoolean(body.autoApplySiblingDiscount, false);
      const siblingDiscountForLastChild = readBoolean(
        body.siblingDiscountForLastChild,
        false,
      );

      const autoSendDay = Number(body.autoSendDay ?? DEFAULT_AUTO_SEND_DAY);
      if (!Number.isInteger(autoSendDay) || autoSendDay < 1 || autoSendDay > 28) {
        return apiFailure(
          'invalid_body',
          'The send day must be a whole number between 1 and 28.',
          400,
        );
      }

      const graceDays = Number(body.graceDays ?? 0);
      if (!Number.isInteger(graceDays) || graceDays < 0 || graceDays > 90) {
        return apiFailure(
          'invalid_body',
          'Grace days must be a whole number between 0 and 90.',
          400,
        );
      }

      if (!isLateFeeType(body.lateFeeType)) {
        return apiFailure(
          'invalid_body',
          'Choose whether the late fee is a one-off charge or a daily one.',
          400,
        );
      }

      const amount = Number(body.lateFeeAmount ?? 0);
      if (!Number.isFinite(amount) || amount < 0 || amount > 999_999) {
        return apiFailure(
          'invalid_body',
          'The late fee must be a number between 0 and 999,999.',
          400,
        );
      }

      // A daily charge with no ceiling grows without limit, which no school
      // actually wants — but it is their call, so this only refuses nonsense.
      const maxRaw = body.maxLateFee;
      let maxLateFee: string | null = null;

      if (maxRaw !== null && maxRaw !== undefined && maxRaw !== '') {
        const max = Number(maxRaw);
        if (!Number.isFinite(max) || max < 0 || max > 999_999) {
          return apiFailure(
            'invalid_body',
            'The maximum late fee must be a number between 0 and 999,999.',
            400,
          );
        }
        if (max > 0 && max < amount && body.lateFeeType === 'fixed') {
          return apiFailure(
            'invalid_body',
            'The cap cannot be lower than the late fee itself.',
            400,
          );
        }
        maxLateFee = paiseToNumeric(toPaise(max));
      }

      if (isEnabled && amount <= 0) {
        return apiFailure(
          'invalid_body',
          'Enter a late fee amount before switching late fees on.',
          400,
        );
      }

      await db
        .insert(lateFeeRules)
        .values({
          locationId: auth.locationId,
          dueDay,
          autoSendVouchers,
          autoSendDay,
          isEnabled,
          graceDays,
          lateFeeType: body.lateFeeType,
          lateFeeAmount: paiseToNumeric(toPaise(amount)),
          maxLateFee,
          autoApplySiblingDiscount,
          siblingDiscountForLastChild,
        })
        .onConflictDoUpdate({
          target: lateFeeRules.locationId,
          set: {
            dueDay,
            autoSendVouchers,
            autoSendDay,
            isEnabled,
            graceDays,
            lateFeeType: body.lateFeeType,
            lateFeeAmount: paiseToNumeric(toPaise(amount)),
            maxLateFee,
            autoApplySiblingDiscount,
            siblingDiscountForLastChild,
            updatedAt: new Date(),
          },
        });

      return apiSuccess({ settings: await getLateFeeRule(auth.locationId) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'fees.write' },
);
