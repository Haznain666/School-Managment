import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { listSignalsSince } from '@/lib/chat-queries';
import { USER_ROLES } from '@/types/school-auth';

/**
 * /api/school/chat/signals — what you missed while the socket was down.
 *
 * The browser subscribes to `chat_signals` directly through Supabase Realtime,
 * gated by that table's RLS policy. This route is the catch-up half: a client
 * that reconnects asks what arrived while it was away, rather than trusting
 * that a socket which was disconnected delivered everything.
 *
 * It answers with the same thing the socket carries — conversation ids and
 * message ids, no content — so a client's two paths into the same state are
 * identical and only one of them has to be got right. Content still comes from
 * `/conversations/[id]/messages`, under a fresh membership check.
 *
 * `auth.uid` is the GoTrue id, which is exactly what `recipient_auth_user_id`
 * holds; nothing about the caller is read from the request.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** How far back a catch-up may reach. Signals are pruned at 24 hours anyway. */
const MAX_LOOKBACK_MS = 24 * 60 * 60 * 1000;

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const sinceRaw = new URL(request.url).searchParams.get('since');
      if (sinceRaw === null) {
        return apiFailure('invalid_query', 'Send a since timestamp.', 400);
      }

      const since = new Date(sinceRaw);
      if (Number.isNaN(since.getTime())) {
        return apiFailure('invalid_query', 'since must be an ISO timestamp.', 400);
      }

      const floor = new Date(Date.now() - MAX_LOOKBACK_MS);
      const from = since.getTime() < floor.getTime() ? floor : since;

      const signals = await listSignalsSince(auth.locationId, auth.uid, from);
      return apiSuccess({ signals, from });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: USER_ROLES },
);
