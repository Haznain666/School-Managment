import { and, eq } from 'drizzle-orm';

import { holidays, isHolidayType } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { schoolUserIdForUid } from '@/lib/accounting-queries';
import { db } from '@/lib/drizzle';
import { deleteHoliday, getHoliday } from '@/lib/holiday-queries';
import { isUuid, readOptionalString } from '@/lib/validation';

/**
 * /api/school/holidays/[holidayId]
 *
 * PATCH  move it, rename it, or confirm a tentative date
 * DELETE remove it
 *
 * ── Moving a date clears `is_tentative`, and that is the whole point ─────
 * Every religious holiday is seeded tentative because the tabular Islamic
 * calendar is an approximation and Pakistan decides these by moon sighting.
 * When HR or a Branch Administrator moves one, a person has said what the date
 * is — so the badge comes off, automatically, without a second control that
 * somebody would forget to press.
 *
 * A caller can still set it back to tentative explicitly (`isTentative: true`),
 * for the school that has been told Eid is "the 20th or the 21st" and wants to
 * say so.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ holidayId: string }> };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;

  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

interface UpdateBody {
  name?: unknown;
  startsOn?: unknown;
  endsOn?: unknown;
  holidayType?: unknown;
  isTentative?: unknown;
  notes?: unknown;
}

export const PATCH = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { holidayId } = await context.params;
      if (!isUuid(holidayId)) {
        return apiFailure('not_found', 'Holiday not found.', 404);
      }

      const existing = await getHoliday(auth.locationId, holidayId);
      if (existing === null) {
        return apiFailure('not_found', 'Holiday not found.', 404);
      }

      const body = await readJsonBody<UpdateBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const name =
        typeof body.name === 'string' && body.name.trim() !== ''
          ? body.name.trim()
          : existing.name;

      const startsOn = isIsoDate(body.startsOn) ? body.startsOn : existing.startsOn;
      const endsOn = isIsoDate(body.endsOn) ? body.endsOn : existing.endsOn;

      if (endsOn < startsOn) {
        return apiFailure('invalid_body', 'The holiday ends before it starts.', 400);
      }

      const holidayType = isHolidayType(body.holidayType)
        ? body.holidayType
        : existing.holidayType;

      /*
       * A moved date is a confirmed date.
       *
       * The flag falls to false the moment either end of the range changes,
       * because a person has just typed the date. An explicit `isTentative` in
       * the body still wins — a school told "the 20th or the 21st" can say so —
       * but the default is the one that stops a confirmed Eid carrying a
       * *Tentative* badge for the rest of the year because nobody found the
       * second control.
       */
      const moved = startsOn !== existing.startsOn || endsOn !== existing.endsOn;
      const isTentative =
        typeof body.isTentative === 'boolean'
          ? body.isTentative
          : moved
            ? false
            : existing.isTentative;

      const [updated] = await db
        .update(holidays)
        .set({
          name,
          startsOn,
          endsOn,
          holidayType,
          isTentative,
          notes:
            body.notes === undefined ? existing.notes : readOptionalString(body.notes),
          updatedBy: await schoolUserIdForUid(auth.locationId, auth.uid),
          updatedAt: new Date(),
        })
        .where(
          and(eq(holidays.locationId, auth.locationId), eq(holidays.id, holidayId)),
        )
        .returning({ id: holidays.id, isTentative: holidays.isTentative });

      return apiSuccess({ holiday: updated ?? null });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'calendar.manage' },
);

export const DELETE = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { holidayId } = await context.params;
      if (!isUuid(holidayId)) {
        return apiFailure('not_found', 'Holiday not found.', 404);
      }

      const removed = await deleteHoliday(auth.locationId, holidayId);
      if (!removed) return apiFailure('not_found', 'Holiday not found.', 404);

      return apiSuccess({ deleted: true });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'calendar.manage' },
);
