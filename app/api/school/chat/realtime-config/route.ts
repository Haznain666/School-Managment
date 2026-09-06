import { and, eq } from 'drizzle-orm';

import { chatSettings } from '@/db/schema/chat-settings';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiSuccess, handleApiError } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { getSchoolUserByUid } from '@/lib/school-queries';
import { getSessionClient } from '@/lib/supabase-auth';
import { USER_ROLES } from '@/types/school-auth';

/**
 * /api/school/chat/realtime-config — what the browser needs to open a socket.
 *
 * ── Why this route exists rather than three public env vars ──────────────
 * A `NEXT_PUBLIC_*` value is baked into the bundle at build time, so rotating
 * one on Hostinger means a rebuild rather than a restart. Everything here is
 * read from server-only variables and handed to a signed-in caller instead, so
 * a key rotation is a process restart and nothing else.
 *
 * ── The access token, and why it is here ─────────────────────────────────
 * This is a deliberate, narrow relaxation of a posture this codebase chose on
 * purpose, so it is written down rather than slipped in.
 *
 * `lib/supabase-auth.ts` sets the session cookie `httpOnly: true`. Browser
 * JavaScript therefore cannot read the access token — which is the point.
 *
 * But `chat_signals`' row-level security policy is
 * `USING (recipient_auth_user_id = auth.uid()::text)`, and `auth.uid()` is
 * derived from the token the Realtime connection authenticates with. A browser
 * client built from the URL and the anon key alone connects as `anon`, has no
 * `auth.uid()`, matches no row, and therefore **subscribes successfully and
 * receives nothing, forever** — the exact silent failure `0041`'s step 8 warns
 * about, arrived at by a different road. Real-time cannot work without the
 * token reaching the client.
 *
 * ── What that actually costs, stated honestly ────────────────────────────
 * `httpOnly` defends against one thing: script reading `document.cookie`. It
 * does not defend against script *calling this route* — any XSS able to read a
 * cookie is equally able to `fetch('/api/school/chat/realtime-config')` with
 * the cookie attached and get the same token. So the marginal exposure this
 * adds over the status quo is close to zero, and `httpOnly` keeps doing the job
 * it was chosen for.
 *
 * What is *not* free is where the token then lives. So the client contract is
 * strict, and `components/chat/useChatStream.ts` honours it: the token is held
 * in a closure variable, **never** written to `localStorage`, `sessionStorage`,
 * a cookie or the DOM, never logged, and re-fetched from here on reconnect
 * rather than cached against expiry.
 *
 * ── `sound_enabled` rides along, and that is a deliberate saving ─────────
 * Sprint 29 mounts `ChatStreamProvider` in every portal layout, so this route
 * is now fetched once per page load rather than once per visit to the chat
 * screen — and the chime it arms needs one boolean out of `chat_settings`. A
 * second round trip for one column, on every page of every portal, to decide
 * whether a sound plays, is a cost with nothing behind it. It is here because
 * this route is already "everything the browser needs to react to a message",
 * which is what the name says and what it now contains.
 *
 * ── `getSession`, not `getUser`, and only here ───────────────────────────
 * `lib/supabase-auth.ts` is emphatic that every authorization decision starts
 * from `getUser()`, because `getSession()` returns whatever the cookie claims
 * without verifying it. Nothing is being authorized here: `withSchoolAuth` has
 * already run `getUser()` and `membershipFor()` before this handler executes.
 * This is reading a token out of a session that has *already* been verified, to
 * hand back to the person it belongs to, and `getSession` is the only call that
 * exposes it.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (_request, auth) => {
    try {
      const url = process.env.SUPABASE_URL?.trim().replace(/\/+$/, '') ?? '';
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? '';

      /*
       * The chime's preference. Read before the early return below, because a
       * deployment with no Supabase credentials still polls, still receives
       * signals, and should still make a noise about them.
       *
       * An absent row is the defaults, exactly as `/chat/settings` treats it —
       * provisioning seeds nothing and the column's own default is on.
       */
      const soundEnabled = await readSoundPreference(auth.locationId, auth.uid);

      if (url === '' || anonKey === '') {
        // Not a 500. Real-time is an enhancement over a working poll, and a
        // misconfigured deployment should degrade to polling rather than break
        // the chat screen.
        return apiSuccess({
          supabaseUrl: null,
          anonKey: null,
          accessToken: null,
          vapidPublicKey: null,
          soundEnabled,
        });
      }

      const client = await getSessionClient();
      const { data } = await client.auth.getSession();

      return apiSuccess({
        supabaseUrl: url,
        anonKey,
        /** Null when the session has no token; the client then polls. */
        accessToken: data.session?.access_token ?? null,
        /**
         * The VAPID public key is public by definition — it is what the push
         * service checks a signature against. The private key never leaves the
         * server and is not read here.
         */
        vapidPublicKey: process.env.VAPID_PUBLIC_KEY?.trim() ?? null,
        soundEnabled,
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: USER_ROLES },
);

/**
 * This caller's chime preference, or the default when anything is in the way.
 *
 * Never throws. A preference that cannot be read is a sound that plays — which
 * is the column's default and the safe direction: the failure mode of guessing
 * "on" is one unexpected chime, and of guessing "off" is a notification nobody
 * receives, which is the defect this whole sprint exists to fix.
 */
async function readSoundPreference(locationId: string, uid: string): Promise<boolean> {
  try {
    const me = await getSchoolUserByUid(locationId, uid);
    if (me === null) return true;

    const rows = await db
      .select({ soundEnabled: chatSettings.soundEnabled })
      .from(chatSettings)
      .where(
        and(eq(chatSettings.locationId, locationId), eq(chatSettings.schoolUserId, me.id)),
      )
      .limit(1);

    return rows[0]?.soundEnabled ?? true;
  } catch (error) {
    console.error('[chat] sound preference could not be read:', error);
    return true;
  }
}
