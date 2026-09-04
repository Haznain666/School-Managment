import { and, eq } from 'drizzle-orm';

import { pushSubscriptions } from '@/db/schema/push-subscriptions';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { getSchoolUserByUid } from '@/lib/school-queries';
import { USER_ROLES } from '@/types/school-auth';

/**
 * /api/school/chat/push-subscription — this browser, registered or forgotten.
 *
 * ── The upsert is on `endpoint`, and that is the whole design ────────────
 * The push service's endpoint URL *is* the identity of one browser on one
 * device. Re-subscribing — after clearing site data, after a browser update,
 * after signing in as somebody else on a shared laptop — produces the same
 * endpoint, so `onConflictDoUpdate` moves it to whoever is signed in now rather
 * than leaving two rows racing to notify one browser.
 *
 * That is also why the unique index is not tenant-scoped. A browser is a
 * browser; a parent with children at two schools on this platform holds one
 * subscription, pointed at whichever portal they last enabled it from.
 *
 * ── DELETE is not the same as "stop notifying me" ────────────────────────
 * DELETE forgets *this browser*. Turning notifications off everywhere is
 * `push_chat` on the notification preferences, which survives re-subscribing.
 * Both exist because they are different intentions: one is "not on this
 * machine", the other is "not at all".
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SubscribeBody {
  endpoint?: unknown;
  p256dh?: unknown;
  auth?: unknown;
  userAgent?: unknown;
}

interface UnsubscribeBody {
  endpoint?: unknown;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<SubscribeBody>(request);
      const endpoint = body?.endpoint;
      const p256dh = body?.p256dh;
      const authKey = body?.auth;

      if (
        typeof endpoint !== 'string' ||
        endpoint === '' ||
        typeof p256dh !== 'string' ||
        p256dh === '' ||
        typeof authKey !== 'string' ||
        authKey === ''
      ) {
        return apiFailure('invalid_body', 'That is not a push subscription.', 400);
      }

      // A push endpoint is a URL the server will later POST to. Refusing
      // anything that is not https is the one check standing between this table
      // and being told to send credentials somewhere else.
      if (!endpoint.startsWith('https://')) {
        return apiFailure('invalid_body', 'A push endpoint must be https.', 400);
      }
      if (endpoint.length > 2000) {
        return apiFailure('invalid_body', 'That endpoint is implausibly long.', 400);
      }

      const me = await getSchoolUserByUid(auth.locationId, auth.uid);
      if (me === null) return apiFailure('not_found', 'No account at this school.', 404);

      const userAgent =
        typeof body?.userAgent === 'string' ? body.userAgent.slice(0, 300) : null;

      await db
        .insert(pushSubscriptions)
        .values({
          locationId: auth.locationId,
          schoolUserId: me.id,
          endpoint,
          p256dh,
          auth: authKey,
          userAgent,
        })
        .onConflictDoUpdate({
          target: pushSubscriptions.endpoint,
          set: {
            locationId: auth.locationId,
            schoolUserId: me.id,
            p256dh,
            auth: authKey,
            userAgent,
            failureCount: 0,
          },
        });

      return apiSuccess({ subscribed: true }, 201);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: USER_ROLES },
);

export const DELETE = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<UnsubscribeBody>(request);
      const endpoint = body?.endpoint;

      if (typeof endpoint !== 'string' || endpoint === '') {
        return apiFailure('invalid_body', 'Say which subscription to forget.', 400);
      }

      const me = await getSchoolUserByUid(auth.locationId, auth.uid);
      if (me === null) return apiFailure('not_found', 'No account at this school.', 404);

      // Scoped to the caller's own row: an endpoint from somebody else's
      // browser matches nothing rather than unsubscribing them.
      const removed = await db
        .delete(pushSubscriptions)
        .where(
          and(
            eq(pushSubscriptions.locationId, auth.locationId),
            eq(pushSubscriptions.schoolUserId, me.id),
            eq(pushSubscriptions.endpoint, endpoint),
          ),
        )
        .returning({ id: pushSubscriptions.id });

      return apiSuccess({ forgotten: removed.length > 0 });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: USER_ROLES },
);
