import { holidays, staffCalendarOverrides } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { schoolUserIdForUid } from '@/lib/accounting-queries';
import { db } from '@/lib/drizzle';
import { getHoliday } from '@/lib/holiday-queries';
import { resolveBranchScope } from '@/lib/branch-scope';
import {
  calendarIsVisible,
  calendarWriteRefusal,
  getStaffCalendar,
  listCalendarOverrides,
} from '@/lib/staff-calendar-queries';
import { isIsoDate, isUuid, readBoolean, readOptionalString, readString } from '@/lib/validation';
import { USER_ROLES } from '@/types/school-auth';

/**
 * /api/school/staff-calendars/[calendarId]/overrides — Sprint 33b.
 *
 * GET  what this calendar changes about the school's holidays
 * POST cancel one, move one, or add a closure this calendar's people get
 *
 * ── An override always names a holiday ───────────────────────────────────
 * Including the ones that *add* days: posting without a `holidayId` writes the
 * `holidays` row first and binds it here. That is what keeps the school's
 * calendar the single list of days it is shut, and it is what lets **Notify**
 * be `POST /api/school/holidays/[holidayId]/notify` — the path that already
 * builds an announcement with `audience: { kind: 'roles', roles }`, resolves
 * the audience and the branch scope, writes the notice and bell rows, and
 * honours every email preference on the way.
 *
 * A second delivery path for staff holidays would be a second place all of
 * that is decided, and the first time the two disagreed somebody who had opted
 * out would receive mail. There is one path, and this route does not send
 * anything itself.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ calendarId: string }> };

export const GET = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { calendarId } = await context.params;
      if (!isUuid(calendarId)) {
        return apiFailure('not_found', 'Calendar not found.', 404);
      }

      const calendar = await getStaffCalendar(auth.locationId, calendarId);
      if (calendar === null) {
        return apiFailure('not_found', 'Calendar not found.', 404);
      }

      // The campus, on the read — QA round 2, N1. The write below has checked
      // this since round 1; the read checked only the tenant, so another
      // campus's overrides came back to anybody holding `leave.read` and the
      // id. **404, not 403**: a campus-bound reader should not learn that the
      // other campus's calendar exists, which is the same answer the legacy
      // leave GET gives for a request at another campus.
      if (
        !calendarIsVisible(await resolveBranchScope(auth.locationId, auth), calendar.branchId)
      ) {
        return apiFailure('not_found', 'Calendar not found.', 404);
      }

      return apiSuccess({
        calendar,
        overrides: await listCalendarOverrides(auth.locationId, calendarId),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'leave.read' },
);

interface CreateOverrideBody {
  /** An existing holiday. Absent = create one for this calendar. */
  holidayId?: unknown;
  /** Only when creating: what the closure is called and when it runs. */
  name?: unknown;
  startsOn?: unknown;
  endsOn?: unknown;
  /** Empty = everybody on this calendar. */
  appliesToRoles?: unknown;
  isCancelled?: unknown;
  movedStartsOn?: unknown;
  movedEndsOn?: unknown;
  notify?: unknown;
}

/** Only roles this build knows about, deduplicated, order preserved. */
function readRoles(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(
      raw.filter((role): role is string => (USER_ROLES as readonly unknown[]).includes(role)),
    ),
  ];
}

export const POST = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { calendarId } = await context.params;
      if (!isUuid(calendarId)) {
        return apiFailure('not_found', 'Calendar not found.', 404);
      }

      const calendar = await getStaffCalendar(auth.locationId, calendarId);
      if (calendar === null) {
        return apiFailure('not_found', 'Calendar not found.', 404);
      }

      // The campus, on the write — QA round 1, F2. The caller's whole scope,
      // granted campuses included, not `auth.branchId` alone.
      const refusal = calendarWriteRefusal(
        await resolveBranchScope(auth.locationId, auth),
        calendar.branchId,
      );
      if (refusal !== null) return apiFailure('forbidden', refusal, 403);

      const body = await readJsonBody<CreateOverrideBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const movedStartsOn = readOptionalString(body.movedStartsOn);
      const movedEndsOn = readOptionalString(body.movedEndsOn);
      const isCancelled = readBoolean(body.isCancelled, false);

      if ((movedStartsOn === null) !== (movedEndsOn === null)) {
        return apiFailure('invalid_body', 'Moving a holiday needs both new dates.', 400);
      }
      if (movedStartsOn !== null && movedEndsOn !== null) {
        if (!isIsoDate(movedStartsOn) || !isIsoDate(movedEndsOn) || movedEndsOn < movedStartsOn) {
          return apiFailure('invalid_body', 'Enter a valid range for the new dates.', 400);
        }
        if (isCancelled) {
          return apiFailure(
            'invalid_body',
            'A holiday is either cancelled for these people or moved for them, not both.',
            400,
          );
        }
      }

      let holidayId = readOptionalString(body.holidayId);

      if (holidayId === null) {
        /*
         * A closure this calendar's people get and the rest of the school does
         * not — "June and July off for teaching staff" is exactly this. The
         * `holidays` row is written against the **calendar's** campus so a
         * campus closure is not announced to the school that stays open, and
         * `source: 'manual'` keeps the gazetted seed from ever overwriting it.
         */
        const name = readString(body.name);
        const startsOn = readOptionalString(body.startsOn);
        const endsOn = readOptionalString(body.endsOn);

        if (name === '' || name.length > 80) {
          return apiFailure('invalid_body', 'Name the closure, in 80 characters or fewer.', 400);
        }
        if (
          startsOn === null ||
          endsOn === null ||
          !isIsoDate(startsOn) ||
          !isIsoDate(endsOn) ||
          endsOn < startsOn
        ) {
          return apiFailure('invalid_body', 'Enter the dates the closure runs.', 400);
        }

        const created = await db
          .insert(holidays)
          .values({
            locationId: auth.locationId,
            branchId: calendar.branchId,
            name,
            startsOn,
            endsOn,
            holidayType: 'school',
            source: 'manual',
            createdBy: await schoolUserIdForUid(auth.locationId, auth.uid),
          })
          .onConflictDoNothing()
          .returning({ id: holidays.id });

        if (created[0] === undefined) {
          return apiFailure(
            'duplicate',
            `Your school already has a holiday called "${name}" starting that day.`,
            409,
          );
        }

        holidayId = created[0].id;
      } else {
        if (!isUuid(holidayId)) {
          return apiFailure('invalid_body', 'Choose a valid holiday.', 400);
        }
        // Existence *and* tenancy in one check.
        const holiday = await getHoliday(auth.locationId, holidayId);
        if (holiday === null) {
          return apiFailure('not_found', 'Holiday not found.', 404);
        }
      }

      const inserted = await db
        .insert(staffCalendarOverrides)
        .values({
          // Tenant from the verified session, never from the body.
          locationId: auth.locationId,
          calendarId,
          holidayId,
          appliesToRoles: readRoles(body.appliesToRoles),
          isCancelled,
          movedStartsOn,
          movedEndsOn,
          notify: readBoolean(body.notify, false),
          createdBy: await schoolUserIdForUid(auth.locationId, auth.uid),
        })
        .onConflictDoNothing({
          target: [staffCalendarOverrides.calendarId, staffCalendarOverrides.holidayId],
        })
        .returning({ id: staffCalendarOverrides.id });

      if (inserted[0] === undefined) {
        return apiFailure(
          'duplicate',
          'This calendar already says something about that holiday. Edit that entry instead.',
          409,
        );
      }

      return apiSuccess(
        {
          overrideId: inserted[0].id,
          holidayId,
          overrides: await listCalendarOverrides(auth.locationId, calendarId),
        },
        201,
      );
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'leave.manage' },
);
