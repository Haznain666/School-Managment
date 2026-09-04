import { announcements } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { schoolUserIdForUid } from '@/lib/accounting-queries';
import { sendAnnouncement } from '@/lib/announcement-queries';
import { db } from '@/lib/drizzle';
import { noticeFor } from '@/lib/holiday-notifier';
import { getHoliday } from '@/lib/holiday-queries';
import { isUuid } from '@/lib/validation';
import { USER_ROLES } from '@/types/school-auth';

/**
 * /api/school/holidays/[holidayId]/notify
 *
 * POST tell chosen roles about this holiday, now.
 *
 * ── Why this reuses the announcement path entirely ───────────────────────
 * It creates an announcement with `audience: { kind: 'roles', roles }` and
 * sends it through `sendAnnouncement`. Nothing new decides who gets what:
 * `lib/announcement-audience.ts` resolves the audience, the notice rows are
 * written, the bell rows are written, and — if the school asked — the email run
 * is queued and drained by the outbox.
 *
 * A second delivery path for holidays would be a second place for the
 * branch-scope rules and the email preferences to be applied, and the first
 * time the two disagreed a parent who had opted out would receive one anyway.
 *
 * ── Gated on `comms.send`, not on `calendar.manage` ──────────────────────
 * Because this is *sending*, and sending is the thing `comms.send` exists to
 * separate from writing. HR and a Branch Administrator hold it by their
 * existing defaults, which is exactly who the requirement names. Somebody who
 * may edit the calendar but not send is stopped here rather than at the point
 * where four hundred parents have already been written to.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ holidayId: string }> };

interface NotifyBody {
  roles?: unknown;
  /** Whether it also goes out as email, not only to the board and the bell. */
  sendEmail?: unknown;
}

export const POST = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { holidayId } = await context.params;
      if (!isUuid(holidayId)) {
        return apiFailure('not_found', 'Holiday not found.', 404);
      }

      const holiday = await getHoliday(auth.locationId, holidayId);
      if (holiday === null) {
        return apiFailure('not_found', 'Holiday not found.', 404);
      }

      const body = await readJsonBody<NotifyBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const roles = Array.isArray(body.roles)
        ? [
            ...new Set(
              body.roles.filter((role): role is string =>
                (USER_ROLES as readonly unknown[]).includes(role),
              ),
            ),
          ]
        : [];

      if (roles.length === 0) {
        return apiFailure('invalid_body', 'Choose at least one role to tell.', 400);
      }

      // The same sentence the automatic notice uses, from the same function.
      // A holiday announced by hand and one announced by the sweeper must not
      // read differently — a parent comparing the two would be right to ask
      // which was official.
      const notice = noticeFor({
        startsOn: holiday.startsOn,
        endsOn: holiday.endsOn,
        holidays: [
          {
            name: holiday.name,
            startsOn: holiday.startsOn,
            endsOn: holiday.endsOn,
          },
        ],
      });

      const [announcement] = await db
        .insert(announcements)
        .values({
          locationId: auth.locationId,
          // The campus the holiday closes, so a campus-specific closure is not
          // announced to the school that stays open.
          branchId: holiday.branchId,
          title: notice.title,
          body: notice.body,
          audience: { kind: 'roles', roles },
          status: 'draft',
          sendEmail: body.sendEmail === true,
          createdBy: await schoolUserIdForUid(auth.locationId, auth.uid),
        })
        .returning({ id: announcements.id });

      if (announcement === undefined) {
        return apiFailure('internal_error', 'The notice could not be written.', 500);
      }

      const outcome = await sendAnnouncement(auth.locationId, announcement.id);

      return apiSuccess({ announcementId: announcement.id, outcome }, 201);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'comms.send' },
);
