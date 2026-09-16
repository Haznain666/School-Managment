import { isHolidaySpan } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { schoolUserIdForUid } from '@/lib/accounting-queries';
import { resolveBranchScope, scopeAdmitsWrite } from '@/lib/branch-scope';
import { listHolidaySpans, setHolidaySpan } from '@/lib/leave-queries';
import { isUuid, readOptionalString } from '@/lib/validation';

/**
 * /api/school/leave/settings — decision 8, and it is one setting per campus.
 *
 * GET  what every campus has chosen
 * PUT  change one of them
 *
 * *Does a gazetted holiday inside a leave range come out of the person's
 * entitlement?* `include` says yes and is the default, because it is what the
 * product did before this table existed and what decision 11 states. `skip`
 * says no. It applies to everybody at that campus, teaching and non-teaching
 * alike — the product owner was asked and did not want a third answer.
 *
 * A campus with no row of its own inherits the school's, and the screen says
 * which it is doing. `branchId: null` sets the school's own default.
 *
 * Gated on `leave.manage` — HR's key. Setting the rule and signing off against
 * it are different jobs, which is why they are different keys.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (_request, auth) => {
    try {
      return apiSuccess({ settings: await listHolidaySpans(auth.locationId) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'leave.manage' },
);

interface SettingsBody {
  /** Null or absent = the school's own default. */
  branchId?: unknown;
  holidaySpan?: unknown;
}

export const PUT = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<SettingsBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      if (!isHolidaySpan(body.holidaySpan)) {
        return apiFailure(
          'invalid_body',
          'Choose whether a holiday inside a leave range is counted.',
          400,
        );
      }

      const branchId = readOptionalString(body.branchId);
      if (branchId !== null && !isUuid(branchId)) {
        return apiFailure('invalid_body', 'Choose a valid campus.', 400);
      }

      /*
       * The campus, checked on the write — item 2e's rule, and it matters more
       * here than on a catalogue row: a campus-bound HR manager setting the
       * *school's* default would be changing how leave is counted at every
       * other campus, from a screen that shows them only their own.
       */
      const scope = await resolveBranchScope(auth.locationId, auth);
      if (!scopeAdmitsWrite(scope, branchId)) {
        return apiFailure(
          'forbidden',
          branchId === null
            ? 'Only a school-wide administrator can set the rule every campus falls back to.'
            : 'That campus is not one you have access to.',
          403,
        );
      }

      await setHolidaySpan(
        auth.locationId,
        branchId,
        body.holidaySpan,
        await schoolUserIdForUid(auth.locationId, auth.uid),
      );

      return apiSuccess({ settings: await listHolidaySpans(auth.locationId) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'leave.manage' },
);
