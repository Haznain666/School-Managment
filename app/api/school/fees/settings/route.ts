import { eq } from 'drizzle-orm';

import { DEFAULT_DUE_DAY, isLateFeeType, lateFeeRules } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { getLateFeeRule } from '@/lib/fee-queries';
import { FEE_READ_ROLES, FEE_WRITE_ROLES } from '@/lib/fee-roles';
import { paiseToNumericString, parsePaise } from '@/lib/money';
import { readBoolean, readOptionalString, readString } from '@/lib/validation';

/**
 * /api/school/fees/settings — the school's fee policy.
 *
 * GET   the current rule, or the platform defaults when none has been saved
 * PATCH upsert it
 *
 * GET never returns null: a school that has not opened this page still needs a
 * due day and a "late fees off" answer, and making every caller handle absence
 * would mean four places deciding what the default is.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (_request, auth) => {
    try {
      const rule = await getLateFeeRule(auth.locationId);

      if (rule !== null) return apiSuccess({ settings: rule, isConfigured: true });

      return apiSuccess({
        settings: {
          locationId: auth.locationId,
          isEnabled: false,
          graceDays: 0,
          lateFeeType: 'fixed' as const,
          lateFeeAmount: '0.00',
          maxLateFee: null,
          dueDayOfMonth: DEFAULT_DUE_DAY,
          financialYearStartMonth: 7,
          bankAccountDetails: null,
        },
        isConfigured: false,
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: FEE_READ_ROLES },
);

interface UpdateSettingsBody {
  isEnabled?: unknown;
  graceDays?: unknown;
  lateFeeType?: unknown;
  lateFeeAmount?: unknown;
  maxLateFee?: unknown;
  dueDayOfMonth?: unknown;
  financialYearStartMonth?: unknown;
  bankAccountDetails?: unknown;
}

export const PATCH = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<UpdateSettingsBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const existing = await getLateFeeRule(auth.locationId);

      const isEnabled = readBoolean(body.isEnabled, existing?.isEnabled ?? false);

      const graceDaysRaw = Number(body.graceDays ?? existing?.graceDays ?? 0);
      if (!Number.isInteger(graceDaysRaw) || graceDaysRaw < 0 || graceDaysRaw > 90) {
        return apiFailure('invalid_body', 'Grace days must be between 0 and 90.', 400);
      }

      const lateFeeTypeRaw = body.lateFeeType ?? existing?.lateFeeType ?? 'fixed';
      if (!isLateFeeType(lateFeeTypeRaw)) {
        return apiFailure(
          'invalid_body',
          'Choose whether the late fee is a flat charge or per day.',
          400,
        );
      }

      const amountSource =
        body.lateFeeAmount === undefined
          ? (existing?.lateFeeAmount ?? '0')
          : readString(body.lateFeeAmount);

      const amountPaise = parsePaise(amountSource === '' ? '0' : amountSource);
      if (amountPaise === null || amountPaise < 0) {
        return apiFailure('invalid_body', 'Enter the late fee in rupees, e.g. 100.', 400);
      }

      // A late fee that is switched on but set to zero would silently do
      // nothing, which is worse than refusing to save it.
      if (isEnabled && amountPaise === 0) {
        return apiFailure(
          'invalid_body',
          'Set a late fee amount, or switch late fees off.',
          400,
        );
      }

      let maxLateFee: string | null;
      if (body.maxLateFee === undefined) {
        maxLateFee = existing?.maxLateFee ?? null;
      } else {
        const raw = readOptionalString(body.maxLateFee);
        if (raw === null) {
          maxLateFee = null;
        } else {
          const capPaise = parsePaise(raw);
          if (capPaise === null || capPaise < 0) {
            return apiFailure('invalid_body', 'Enter a valid maximum late fee.', 400);
          }
          if (capPaise > 0 && capPaise < amountPaise && lateFeeTypeRaw === 'fixed') {
            return apiFailure(
              'invalid_body',
              'The cap cannot be lower than the flat late fee itself.',
              400,
            );
          }
          maxLateFee = paiseToNumericString(capPaise);
        }
      }

      const dueDay = Number(body.dueDayOfMonth ?? existing?.dueDayOfMonth ?? DEFAULT_DUE_DAY);
      if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 28) {
        // Capped at 28 so every month actually has the day.
        return apiFailure('invalid_body', 'The due day must be between 1 and 28.', 400);
      }

      const fyStart = Number(
        body.financialYearStartMonth ?? existing?.financialYearStartMonth ?? 7,
      );
      if (!Number.isInteger(fyStart) || fyStart < 1 || fyStart > 12) {
        return apiFailure('invalid_body', 'Select a financial year start month.', 400);
      }

      const bankAccountDetails =
        body.bankAccountDetails === undefined
          ? (existing?.bankAccountDetails ?? null)
          : readOptionalString(body.bankAccountDetails);

      const values = {
        locationId: auth.locationId,
        isEnabled,
        graceDays: graceDaysRaw,
        lateFeeType: lateFeeTypeRaw,
        lateFeeAmount: paiseToNumericString(amountPaise),
        maxLateFee,
        dueDayOfMonth: dueDay,
        financialYearStartMonth: fyStart,
        bankAccountDetails,
        updatedAt: new Date(),
      };

      await db
        .insert(lateFeeRules)
        .values(values)
        .onConflictDoUpdate({
          target: lateFeeRules.locationId,
          set: {
            isEnabled: values.isEnabled,
            graceDays: values.graceDays,
            lateFeeType: values.lateFeeType,
            lateFeeAmount: values.lateFeeAmount,
            maxLateFee: values.maxLateFee,
            dueDayOfMonth: values.dueDayOfMonth,
            financialYearStartMonth: values.financialYearStartMonth,
            bankAccountDetails: values.bankAccountDetails,
            updatedAt: values.updatedAt,
          },
        });

      const saved = await db
        .select()
        .from(lateFeeRules)
        .where(eq(lateFeeRules.locationId, auth.locationId))
        .limit(1);

      return apiSuccess({ settings: saved[0] ?? null, isConfigured: true });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: FEE_WRITE_ROLES },
);
