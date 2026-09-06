import { withSchoolAuth } from '@/lib/api-auth';
import { apiSuccess, handleApiError } from '@/lib/api-response';
import { countUnreadConversations } from '@/lib/chat-queries';
import { countUnreadNotifications } from '@/lib/notifications';
import { getSchoolUserByUid } from '@/lib/school-queries';
import { USER_ROLES } from '@/types/school-auth';

/**
 * /api/school/unread-counts — the two numbers in the portal chrome.
 *
 * ── Why this exists, given the layout already computes them ──────────────
 * It exists because `router.refresh()` does not do what this sprint needed it
 * to do, and QA proved that rather than assuming it.
 *
 * The first design had `ChatStreamProvider` call `router.refresh()` when a
 * signal arrived: the layout recomputes both counts on every render, so a
 * refresh would move the bell and the sidebar badge with no new endpoint and
 * no second copy of the arithmetic. It fires the request. On a page reached by
 * **client-side navigation** it also updates the DOM. On the page the browser
 * **hard-loaded**, it does not — measured four times either way against a
 * standalone production build, same URL, same message, the only difference
 * being how the page was reached.
 *
 * That is precisely the wrong way round for the person this sprint is for. A
 * parent opens the portal by typing the address or following a link from an
 * email, lands on their dashboard, and sits there. That page is always the
 * hard-loaded one.
 *
 * ── There is still only one implementation of each count ─────────────────
 * The objection to a second endpoint is that it becomes a second place for the
 * numbers to be wrong. So this calls the **same two functions the five portal
 * layouts call** — `countUnreadNotifications` and `countUnreadConversations` —
 * and adds no arithmetic of its own. Two callers, one implementation.
 *
 * ── It is not polled ─────────────────────────────────────────────────────
 * `ChatStreamProvider` asks only when a signal has arrived, which is the same
 * discipline `NotificationBell` describes for itself: the bell is not on a
 * timer, because the number changes a handful of times a week and the origin
 * costs ~1s uncached (§5aq). A signal is the event; this is the read of what
 * the event did.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (_request, auth) => {
    try {
      const me = await getSchoolUserByUid(auth.locationId, auth.uid);

      /*
       * No membership row is not an error. The platform operator entering a
       * school through "Login as Admin" has none by design — they are not a
       * member of it — and the honest answer for them is zero on both, not a
       * 404 that the provider would then have to special-case.
       */
      if (me === null) return apiSuccess({ notifications: 0, chats: 0 });

      const [notifications, chats] = await Promise.all([
        countUnreadNotifications({ audience: 'school_user', schoolUserId: me.id }),
        countUnreadConversations(auth.locationId, me.id),
      ]);

      return apiSuccess({ notifications, chats });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: USER_ROLES },
);
