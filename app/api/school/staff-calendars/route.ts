import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { schoolUserIdForUid } from '@/lib/accounting-queries';
import {
  effectiveBranchIds,
  readBranchParam,
  resolveBranchScope,
  scopeAdmitsWrite,
} from '@/lib/branch-scope';
import { ensureStaffCalendars, listStaffCalendars } from '@/lib/staff-calendar-queries';
import { isUuid, readOptionalString } from '@/lib/validation';

/**
 * /api/school/staff-calendars — the two staff calendars. Sprint 33b.
 *
 * GET  the calendars this caller may see
 * POST create whichever of the two a campus is missing
 *
 * ── There is nothing to configure until somebody asks ────────────────────
 * A school with no calendars behaves exactly as it did before this sprint: the
 * leave day counter falls back to the plain holiday list, which is what
 * `staffHolidayDates` does when it resolves no calendar. So POST is a button
 * somebody presses when they want June and July off for teaching staff, not
 * something provisioning has to remember.
 *
 * Idempotent through the two partial unique indexes — pressing it twice writes
 * nothing the second time, the same contract the leave-type and holiday seeds
 * have.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);
      const scope = await resolveBranchScope(auth.locationId, auth, readBranchParam(url));

      return apiSuccess({
        calendars: await listStaffCalendars(auth.locationId, effectiveBranchIds(scope)),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'leave.read' },
);

interface CreateCalendarsBody {
  /** Null or absent = the school's own pair. */
  branchId?: unknown;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<CreateCalendarsBody>(request);
      const branchId = body === null ? null : readOptionalString(body.branchId);

      if (branchId !== null && !isUuid(branchId)) {
        return apiFailure('invalid_body', 'Choose a valid campus.', 400);
      }

      const scope = await resolveBranchScope(auth.locationId, auth);
      if (!scopeAdmitsWrite(scope, branchId)) {
        return apiFailure(
          'forbidden',
          branchId === null
            ? 'Only a school-wide administrator can create the calendars every campus falls back to.'
            : 'That campus is not one you have access to.',
          403,
        );
      }

      return apiSuccess(
        {
          calendars: await ensureStaffCalendars(
            auth.locationId,
            branchId,
            await schoolUserIdForUid(auth.locationId, auth.uid),
            // What this caller may see, not what the school has — the answer
            // goes straight onto their screen. QA round 2, N1.
            effectiveBranchIds(scope),
          ),
        },
        201,
      );
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'leave.manage' },
);
