import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { schoolUserIdForUid } from '@/lib/accounting-queries';
import { seedPakistanHolidays } from '@/lib/holiday-queries';
import { pakistanHolidaysFor } from '@/lib/pakistan-holidays';
import { isUuid } from '@/lib/validation';

/**
 * /api/school/holidays/seed
 *
 * GET  what the seed *would* write for a year, without writing anything
 * POST write it, skipping whatever is already there
 *
 * ── The preview and the write are the same function ──────────────────────
 * `pakistanHolidaysFor` is free of the database and of `server-only`, so the
 * dialog previews exactly the rows this route will write — the same discipline
 * `lib/academic-year-runs.ts` follows. A preview computed differently from the
 * write is a preview that is occasionally a lie, and the one time that matters
 * is the one time somebody trusted it.
 *
 * ── Never refuses the whole run because one row exists ───────────────────
 * A school that added Independence Day by hand in January and presses *Load
 * public holidays* in February gets the other eleven, and an answer saying how
 * many of each. Refusing the batch over a duplicate would leave a school with
 * one holiday and no way to get the rest short of deleting the one they had.
 *
 * ── Every Islamic date comes back tentative ──────────────────────────────
 * Without exception. They are derived from the tabular Islamic calendar, which
 * is an arithmetical approximation of a decision Pakistan makes by moon
 * sighting. The screen badges them and `calendar.manage` is who confirms them.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Wide enough for a school planning ahead, narrow enough to be a year. */
function isSeedYear(value: number): boolean {
  return Number.isInteger(value) && value >= 2000 && value <= 2100;
}

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      void auth;

      const year = Number(new URL(request.url).searchParams.get('year'));
      if (!isSeedYear(year)) {
        return apiFailure('invalid_query', 'Choose a year between 2000 and 2100.', 400);
      }

      return apiSuccess({ year, rows: pakistanHolidaysFor(year) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'calendar.manage' },
);

interface SeedBody {
  year?: unknown;
  branchId?: unknown;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<SeedBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const year = Number(body.year);
      if (!isSeedYear(year)) {
        return apiFailure('invalid_body', 'Choose a year between 2000 and 2100.', 400);
      }

      const branchId = typeof body.branchId === 'string' ? body.branchId : null;
      if (branchId !== null && branchId !== '' && !isUuid(branchId)) {
        return apiFailure('invalid_body', 'That campus is not at this school.', 400);
      }

      const result = await seedPakistanHolidays({
        // The tenant comes from the verified session and from nowhere else.
        locationId: auth.locationId,
        year,
        branchId: branchId === null || branchId === '' ? null : branchId,
        actorUserId: await schoolUserIdForUid(auth.locationId, auth.uid),
      });

      return apiSuccess({
        created: result.created,
        alreadyPresent: result.alreadyPresent,
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'calendar.manage' },
);
