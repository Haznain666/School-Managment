import { and, eq } from 'drizzle-orm';

import { chatSettings } from '@/db/schema/chat-settings';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { getSchoolUserByUid } from '@/lib/school-queries';
import { USER_ROLES } from '@/types/school-auth';

/**
 * /api/school/chat/settings — one person's own two settings.
 *
 * `allowedRoles` and not a permission, because these are nobody's business but
 * the account holder's: whether a pupil may start a conversation *with you*,
 * and when you would rather not be notified. An administrator does not set
 * these on somebody's behalf — `ROADMAP.md` settled that in the sentence "one
 * teacher opting in must not opt in the rest", and a school-wide override would
 * be exactly that by another route.
 *
 * The school's own dials — contact hours, the reply window, the turn-taking
 * cap — are a different screen under `settings.write`, because those *are* a
 * school's decision and not a person's.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SettingsBody {
  studentsMayInitiate?: unknown;
  quietHoursFrom?: unknown;
  quietHoursTo?: unknown;
}

function minutesProblem(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1439) {
    return 'Quiet hours are a time of day.';
  }
  return null;
}

export const GET = withSchoolAuth(
  async (_request, auth) => {
    try {
      const me = await getSchoolUserByUid(auth.locationId, auth.uid);
      if (me === null) return apiFailure('not_found', 'No account at this school.', 404);

      const rows = await db
        .select({
          studentsMayInitiate: chatSettings.studentsMayInitiate,
          quietHoursFrom: chatSettings.quietHoursFrom,
          quietHoursTo: chatSettings.quietHoursTo,
        })
        .from(chatSettings)
        .where(
          and(
            eq(chatSettings.locationId, auth.locationId),
            eq(chatSettings.schoolUserId, me.id),
          ),
        )
        .limit(1);

      // An absent row is the defaults, not an error.
      return apiSuccess({
        settings: rows[0] ?? {
          studentsMayInitiate: false,
          quietHoursFrom: null,
          quietHoursTo: null,
        },
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: USER_ROLES },
);

export const PATCH = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<SettingsBody>(request);
      if (body === null) return apiFailure('invalid_body', 'Send some settings.', 400);

      const studentsMayInitiate = body.studentsMayInitiate;
      if (typeof studentsMayInitiate !== 'boolean') {
        return apiFailure('invalid_body', 'Say whether students may start a chat.', 400);
      }

      const from = body.quietHoursFrom ?? null;
      const to = body.quietHoursTo ?? null;

      const problem = minutesProblem(from) ?? minutesProblem(to);
      if (problem !== null) return apiFailure('invalid_body', problem, 400);

      // The table's CHECK says both or neither; refusing here means the person
      // gets a sentence rather than a 23514.
      if ((from === null) !== (to === null)) {
        return apiFailure('invalid_body', 'Set both ends of the quiet hours, or neither.', 400);
      }

      const me = await getSchoolUserByUid(auth.locationId, auth.uid);
      if (me === null) return apiFailure('not_found', 'No account at this school.', 404);

      const now = new Date();

      await db
        .insert(chatSettings)
        .values({
          locationId: auth.locationId,
          schoolUserId: me.id,
          studentsMayInitiate,
          quietHoursFrom: from as number | null,
          quietHoursTo: to as number | null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [chatSettings.locationId, chatSettings.schoolUserId],
          set: {
            studentsMayInitiate,
            quietHoursFrom: from as number | null,
            quietHoursTo: to as number | null,
            updatedAt: now,
          },
        });

      return apiSuccess({ saved: true });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: USER_ROLES },
);
