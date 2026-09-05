import { holidays, isHolidayType } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { schoolUserIdForUid } from '@/lib/accounting-queries';
import { db } from '@/lib/drizzle';
import { listHolidays } from '@/lib/holiday-queries';
import { isUuid, readOptionalString } from '@/lib/validation';
import { USER_ROLES } from '@/types/school-auth';

/**
 * /api/school/holidays
 *
 * GET  the holidays overlapping a date window
 * POST add one
 *
 * ── Reading needs no permission key, and that is the requirement ─────────
 * Every portal user sees the calendar. A parent being told when the school is
 * shut is the whole point of publishing one, and gating the read behind a key
 * no parent holds would produce a calendar page that is empty for the people it
 * exists for. The GET is gated on being signed in and on the tenant matching,
 * which `withSchoolAuth` does before this handler runs.
 *
 * `calendar.manage` gates the writes, and only the writes.
 *
 * ── The tenant is `auth.locationId` and nothing else ─────────────────────
 * `branchId` in the body is a *narrowing within* the school — which campus this
 * closes — never a tenant. A null campus means every campus of this school and
 * no other school's.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;

  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');

      if (!isIsoDate(from) || !isIsoDate(to)) {
        return apiFailure('invalid_query', 'Give a from and to date.', 400);
      }

      if (from > to) {
        return apiFailure('invalid_query', 'The window ends before it starts.', 400);
      }

      const branchId = url.searchParams.get('branchId');
      if (branchId !== null && !isUuid(branchId)) {
        return apiFailure('invalid_query', 'That campus is not at this school.', 400);
      }

      return apiSuccess({
        holidays: await listHolidays(auth.locationId, from, to, branchId),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  // Every signed-in member of the school, including a parent and a pupil.
  // Not a permission: a toggle nobody would ever have a reason to turn off is
  // worse than no toggle, and the calendar exists to be read.
  { allowedRoles: USER_ROLES },
);

interface CreateBody {
  name?: unknown;
  startsOn?: unknown;
  endsOn?: unknown;
  holidayType?: unknown;
  branchId?: unknown;
  isTentative?: unknown;
  notes?: unknown;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<CreateBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (name === '') {
        return apiFailure('invalid_body', 'Give the holiday a name.', 400);
      }

      if (!isIsoDate(body.startsOn)) {
        return apiFailure('invalid_body', 'Choose the first day.', 400);
      }

      // A one-day holiday sends the same date twice rather than omitting the
      // end: the column is NOT NULL and the range check is what makes
      // `expandHolidays` safe to loop over.
      const endsOn = isIsoDate(body.endsOn) ? body.endsOn : body.startsOn;
      if (endsOn < body.startsOn) {
        return apiFailure('invalid_body', 'The holiday ends before it starts.', 400);
      }

      if (!isHolidayType(body.holidayType)) {
        return apiFailure(
          'invalid_body',
          'Say whether this is a public, religious or school holiday.',
          400,
        );
      }

      const branchId = typeof body.branchId === 'string' ? body.branchId : null;
      if (branchId !== null && branchId !== '' && !isUuid(branchId)) {
        return apiFailure('invalid_body', 'That campus is not at this school.', 400);
      }

      const [created] = await db
        .insert(holidays)
        .values({
          // The tenant comes from the verified session and from nowhere else.
          locationId: auth.locationId,
          branchId: branchId === null || branchId === '' ? null : branchId,
          name,
          startsOn: body.startsOn,
          endsOn,
          holidayType: body.holidayType,
          // A person typing a date has confirmed it by definition, so a
          // hand-added holiday is never tentative unless they say so. Only the
          // seed writes `true` on its own account.
          isTentative: body.isTentative === true,
          source: 'manual',
          createdBy: await schoolUserIdForUid(auth.locationId, auth.uid),
          notes: readOptionalString(body.notes),
        })
        // The two partial unique indexes. A school adding Independence Day
        // twice gets one row and a sentence, not a 500.
        .onConflictDoNothing()
        .returning({ id: holidays.id });

      if (created === undefined) {
        return apiFailure(
          'already_exists',
          'That holiday is already on the calendar for that date.',
          409,
        );
      }

      return apiSuccess({ holiday: created }, 201);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'calendar.manage' },
);
