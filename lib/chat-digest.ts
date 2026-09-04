import 'server-only';

import { and, eq, isNull, lt, lte, or, sql } from 'drizzle-orm';

import { chatConversations } from '@/db/schema/chat-conversations';
import { chatParticipants } from '@/db/schema/chat-participants';
import { chatSettings } from '@/db/schema/chat-settings';
import { chatSignals, SIGNAL_RETENTION_HOURS } from '@/db/schema/chat-signals';
import { schoolUsers } from '@/db/schema/school-users';
import { schools } from '@/db/schema/schools';

import { inQuietHours } from './chat-permissions';
import { describeError } from './describe-error';
import { db } from './drizzle';
import { enqueueEmail } from './email-outbox';
import { isStudentCredentialAddress } from './student-credentials';
import { sweepPushNotifications } from './push';
import { filterByEmailPreference } from './notification-preferences';

/**
 * The unread-chat digest, and the prune that rides along with it.
 *
 * ── Why this is not optional in Sprint 24 ────────────────────────────────
 * `ROADMAP.md` is explicit: *"Do not build 24 and stop."* Chat replaces a
 * channel parents read — WhatsApp — with one they have to remember to open, and
 * until Web Push arrives in Sprint 25 the only thing that closes that gap is an
 * email saying somebody wrote to you. A fee reminder sitting unread in an inbox
 * nobody opens is worse than the notice board it replaced.
 *
 * ── Why a digest, and never an email per message ─────────────────────────
 * SMTP on this host is measured at ~103 seconds per message. One email per chat
 * message would put a school's whole conversation volume through a queue that
 * drains twenty at a time every thirty seconds, and a parent in a live exchange
 * with a teacher would receive a dozen emails about a dozen sentences. One
 * summary per person per interval is the shape that survives contact with a
 * real school.
 *
 * The in-app bell is deliberately *not* written to either.
 * `components/ui/NotificationBell.tsx` argues at length for staying quiet, and
 * a `notifications` row per message would drown exactly the events that bell
 * exists to surface. Chat carries its own unread badge instead.
 *
 * ── Claimed, not checked ─────────────────────────────────────────────────
 * `last_digest_at` moves in a conditional `UPDATE … RETURNING` before a single
 * email is queued. Production runs **seven** Node processes with seven
 * independent timers — `STATE.md` records the seven distinct 60-second offsets
 * — and `announcement_recipients` de-duplicates on a unique key while
 * `email_outbox` does not. A read-then-`if` here is seven identical emails to
 * every parent at the school, which is the exact bug Sprint 11 shipped and then
 * fixed.
 *
 * Claim first and revert on failure: a claim that moved and then threw is a
 * digest the school believes went out and nobody received.
 */

/** How often the sweep looks. */
const SWEEP_SECONDS = 5 * 60;

/** The shortest gap between two digests to one person. */
const DIGEST_INTERVAL_MINUTES = 60;

/** How many people one sweep will mail. A blast-radius limit, not a page size. */
const MAX_PER_SWEEP = 200;

let sweepTimer: NodeJS.Timeout | null = null;
let sweeping = false;

interface DigestCandidate {
  locationId: string;
  schoolUserId: string;
  name: string;
  email: string;
  schoolName: string;
  schoolSlug: string;
  unread: number;
  quietHoursFrom: number | null;
  quietHoursTo: number | null;
}

/**
 * Everybody with something unread who has not been mailed recently.
 *
 * ── The alias is spelled to collide with nothing ─────────────────────────
 * `unread_conversation_count` is an aggregate in a statement that joins
 * `school_users`, `schools`, `chat_participants`, `chat_conversations` and
 * `chat_settings`. `CLAUDE.md` records what an alias colliding with a joined
 * column costs: Sprint 18 aliased an aggregate `phone` beside
 * `school_users.phone`, Postgres refused the statement with 42702, and the
 * all-students screen was a 500 at every school for as long as it was live.
 * No table in this statement has a column by this name, and every reference to
 * it is qualified.
 */
async function digestCandidates(now: Date): Promise<DigestCandidate[]> {
  const staleBefore = new Date(now.getTime() - DIGEST_INTERVAL_MINUTES * 60_000);

  return db
    .select({
      locationId: chatParticipants.locationId,
      schoolUserId: chatParticipants.schoolUserId,
      name: schoolUsers.name,
      email: schoolUsers.email,
      schoolName: schools.name,
      schoolSlug: schools.slug,
      unread: sql<number>`count(*)::int`.as('unread_conversation_count'),
      quietHoursFrom: chatSettings.quietHoursFrom,
      quietHoursTo: chatSettings.quietHoursTo,
    })
    .from(chatParticipants)
    .innerJoin(chatConversations, eq(chatConversations.id, chatParticipants.conversationId))
    .innerJoin(schoolUsers, eq(schoolUsers.id, chatParticipants.schoolUserId))
    .innerJoin(schools, eq(schools.locationId, chatParticipants.locationId))
    .leftJoin(
      chatSettings,
      and(
        eq(chatSettings.locationId, chatParticipants.locationId),
        eq(chatSettings.schoolUserId, chatParticipants.schoolUserId),
      ),
    )
    .where(
      and(
        isNull(chatParticipants.leftAt),
        eq(schoolUsers.isActive, true),
        eq(chatConversations.status, 'open'),
        // Something arrived that they have not seen.
        or(
          isNull(chatParticipants.lastReadAt),
          lt(chatParticipants.lastReadAt, chatConversations.lastMessageAt),
        ),
        // And they have not been told about it recently. `lte`/`lt`, never a
        // raw template — CLAUDE.md's rule about a Date reaching the driver
        // unmapped, which kept every scheduled announcement on this platform
        // from ever being released for eight sprints.
        or(
          isNull(chatParticipants.digestedAt),
          lte(chatParticipants.digestedAt, staleBefore),
        ),
      ),
    )
    .groupBy(
      chatParticipants.locationId,
      chatParticipants.schoolUserId,
      schoolUsers.name,
      schoolUsers.email,
      schools.name,
      schools.slug,
      chatSettings.quietHoursFrom,
      chatSettings.quietHoursTo,
    )
    .limit(MAX_PER_SWEEP) as unknown as Promise<DigestCandidate[]>;
}

/**
 * Claims one person's digest.
 *
 * Moves `digested_at` on every one of their participant rows only if it is
 * still stale, and answers whether this process is the one that got it. Exactly
 * one of the seven wins; the other six read zero rows and do nothing.
 */
async function claimDigest(
  locationId: string,
  schoolUserId: string,
  staleBefore: Date,
  now: Date,
): Promise<boolean> {
  const claimed = await db
    .update(chatParticipants)
    .set({ digestedAt: now })
    .where(
      and(
        eq(chatParticipants.locationId, locationId),
        eq(chatParticipants.schoolUserId, schoolUserId),
        or(
          isNull(chatParticipants.digestedAt),
          lte(chatParticipants.digestedAt, staleBefore),
        ),
      ),
    )
    .returning({ id: chatParticipants.id });

  return claimed.length > 0;
}

/** Hands the claim back, so a transient failure is retried rather than lost. */
async function releaseDigest(
  locationId: string,
  schoolUserId: string,
  claimedAt: Date,
): Promise<void> {
  await db
    .update(chatParticipants)
    .set({ digestedAt: null })
    .where(
      and(
        eq(chatParticipants.locationId, locationId),
        eq(chatParticipants.schoolUserId, schoolUserId),
        eq(chatParticipants.digestedAt, claimedAt),
      ),
    );
}

/** Sends what is due. Returns how many people were mailed. */
export async function sweepChatDigests(now: Date = new Date()): Promise<number> {
  const staleBefore = new Date(now.getTime() - DIGEST_INTERVAL_MINUTES * 60_000);
  const candidates = await digestCandidates(now);

  let sent = 0;

  for (const person of candidates) {
    if (person.email === null || person.email === '') continue;

    /*
     * Never a pupil's credential address. Found in QA by reading `email_outbox`
     * and seeing a row addressed to
     * `asst-2026-0002@students.askari-school-system.invalid`.
     *
     * `lib/student-credentials.ts` mints that address precisely so that a pupil
     * has an identity for GoTrue which is **provably not a delivery target** —
     * RFC 2606 reserves the TLD — and its docblock says the property that
     * matters is that no code path can accidentally email a minor. This path
     * was doing exactly that: `school_users.email` is the same column for a
     * pupil as for a member of staff, and the digest reads the column without
     * asking what kind of address is in it.
     *
     * Nothing was delivered, because the address cannot resolve. What it
     * actually cost was a queue row per pupil per hour that could only ever end
     * `failed`, burying real delivery failures in noise — and a claim in a
     * docblock that had quietly stopped being true. `isStudentCredentialAddress`
     * exists for this and was not being called anywhere.
     *
     * A pupil is not left unnotified: they see the message in their own portal,
     * which is where a school wants a child reading it.
     */
    if (isStudentCredentialAddress(person.email)) continue;

    // Quiet hours defer the notification and never the message. The message
    // has already landed; this is only about whether their phone lights up.
    if (inQuietHours(now, person.quietHoursFrom, person.quietHoursTo)) continue;

    // One bulk call per person is one too many, but the alternative is holding
    // every school's preferences in memory across the sweep. `cache()` inside
    // `getNotificationSettings` makes the repeat cheap within a request and
    // this is not one, so it is a real read — and it is the read that stops a
    // school mailing somebody who asked it not to.
    const allowed = await filterByEmailPreference(
      person.locationId,
      [person.schoolUserId],
      'chat',
    );
    if (!allowed.has(person.schoolUserId)) continue;

    if (!(await claimDigest(person.locationId, person.schoolUserId, staleBefore, now))) {
      continue;
    }

    try {
      await enqueueEmail({
        locationId: person.locationId,
        to: person.email,
        subject:
          person.unread === 1
            ? 'You have a new message at school'
            : `You have ${String(person.unread)} conversations waiting`,
        text:
          `Hello ${person.name},\n\n` +
          (person.unread === 1
            ? 'There is one conversation waiting for you in the school portal.\n\n'
            : `There are ${String(person.unread)} conversations waiting for you in the school portal.\n\n`) +
          'Sign in to read and reply. Messages are not sent by email — this is ' +
          'only a note to say something is there.\n\n' +
          `${person.schoolName}\n`,
      });
      sent += 1;
    } catch (caught) {
      // Claim first, revert on failure. A claim that moved and then threw is a
      // digest the school believes went out and nobody received.
      await releaseDigest(person.locationId, person.schoolUserId, now);
      console.error(
        `[chat] digest for ${person.schoolUserId} could not be queued: ${describeError(caught)}`,
      );
    }
  }

  return sent;
}

/**
 * Deletes signals nobody needs any more.
 *
 * A signal is worthless the moment it is delivered, and the transcript lives in
 * `chat_messages`. Left unpruned this is the fastest-growing table in the
 * schema — one row per recipient per message — for data with a useful life
 * measured in seconds.
 */
export async function pruneChatSignals(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - SIGNAL_RETENTION_HOURS * 60 * 60 * 1000);

  const deleted = await db
    .delete(chatSignals)
    .where(lt(chatSignals.createdAt, cutoff))
    .returning({ id: chatSignals.id });

  return deleted.length;
}

/**
 * Closes grants whose window has passed.
 *
 * Strictly speaking unnecessary — the resolver already ignores an expired grant
 * — and worth doing anyway: the "what is open right now" screen reads this
 * table, and a list of a thousand finished two-hour openings is a screen nobody
 * can find today's on.
 */
export async function expireChatGrants(now: Date = new Date()): Promise<number> {
  const { chatGrants } = await import('@/db/schema/chat-grants');

  const closed = await db
    .update(chatGrants)
    .set({ revokedAt: now })
    .where(and(isNull(chatGrants.revokedAt), lt(chatGrants.endsAt, now)))
    .returning({ id: chatGrants.id });

  return closed.length;
}

/** Starts the sweep. Idempotent, like the three timers beside it. */
export function startChatDigest(): void {
  if (sweepTimer !== null) return;

  sweepTimer = setInterval(() => {
    if (sweeping) return;
    sweeping = true;

    void (async () => {
      /*
       * Push first, email second, and the order is the product decision.
       *
       * A push is immediate and an email is an hour's grace; somebody whose
       * phone just buzzed does not also need an email about the same message
       * ninety seconds later. Pushing first means the digest's own per-person
       * claim is still unclaimed when it runs, so a person reachable by push
       * still gets the email an hour later if they never opened it — which is
       * the belt-and-braces the reach problem actually needs.
       */
      const pushed = await sweepPushNotifications();
      const mailed = await sweepChatDigests();
      const pruned = await pruneChatSignals();
      const expired = await expireChatGrants();

      if (pushed > 0) console.info(`[chat] pushed to ${String(pushed)} browsers`);
      if (mailed > 0) console.info(`[chat] queued ${String(mailed)} digests`);
      if (pruned > 0) console.info(`[chat] pruned ${String(pruned)} signals`);
      if (expired > 0) console.info(`[chat] closed ${String(expired)} expired grants`);
    })()
      .catch((caught: unknown) => {
        console.error(`[chat] digest sweep failed: ${describeError(caught)}`);
      })
      .finally(() => {
        sweeping = false;
      });
  }, SWEEP_SECONDS * 1000);

  // Never a reason to refuse to shut down.
  sweepTimer.unref?.();

  console.info(`[chat] digest sweep started (every ${String(SWEEP_SECONDS)}s)`);
}
