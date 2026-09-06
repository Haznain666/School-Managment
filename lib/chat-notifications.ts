import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import { notifications } from '@/db/schema';
import type { UserRole } from '@/types/school-auth';

import { db } from './drizzle';

/**
 * The bell entry a chat message leaves behind.
 *
 * ── Why this exists at all ───────────────────────────────────────────────
 * Sprints 24 and 25 gave chat its own transport — `chat_signals` and the
 * websocket over it — and that transport reaches exactly one screen: the chat
 * screen. A parent sitting on their dashboard when a message arrived had no
 * bell entry, no badge and no chime, and the only thing that ever reached them
 * was the hourly digest email. The product owner reported it against Lahore
 * Grammar in one sentence: *"except email notification, Father 1 has no way of
 * knowing that a message has arrived, even though he is on the portal."*
 *
 * `notifications` is the general "a thing happened, tell somebody" table and
 * every other feature in the product writes to it. Chat was the one that did
 * not. This is that omission closed, and nothing more.
 *
 * ── One row per conversation, not one per message ────────────────────────
 * A teacher sending five lines is one event to a parent, not five. So the
 * write is a **conditional `UPDATE … RETURNING`** against the recipient's
 * existing *unread* entry for this conversation, and an `INSERT` only when that
 * updates nothing — the same claim shape `CLAUDE.md` requires of the sweepers,
 * for the same reason: seven server processes, and a read-then-`if` lets all
 * seven decide to insert.
 *
 * Bumping `created_at` on the update is deliberate. The bell is ordered by it,
 * and a thread that has just been added to belongs at the top rather than
 * wherever its first message left it.
 *
 * ── The row carries no message text, and that is the product's rule ──────
 * `lib/chat-digest.ts` already says it to every parent it mails: *"Messages are
 * not sent by email — this is only a note to say something is there."* The bell
 * is the same promise on a different surface. So the entry names the sender and
 * the subject and stops, which also means a message redacted an hour later
 * leaves no copy of itself sitting in a bell panel that `markNotificationsRead`
 * would never revisit.
 *
 * ── No email from here ───────────────────────────────────────────────────
 * `notify()` in `lib/notifications.ts` is the door for everything that wants
 * the bell *and* the mail, and it is the right door for all of them — except
 * this one. Chat already has its own mail: one digest per person per hour,
 * claimed so that seven processes send one, and honouring quiet hours and the
 * per-category email preference that a bell entry has no business consulting.
 * Routing chat through `notify()` would mail a parent once per message and
 * again in the digest, which is how people turn a school's email off.
 *
 * So this writes the bell row directly and says why here rather than growing a
 * `sendEmail: false` flag on `notify()` that the next caller would copy without
 * reading the reason.
 */

/** The kind every chat bell entry carries. One string, matched on for dedupe. */
export const CHAT_NOTIFICATION_KIND = 'chat_message';

/**
 * Where the bell entry lands, per portal.
 *
 * The conversation id rides along as a query parameter and `ChatWorkspace`
 * opens that thread on mount. Without it the entry drops you at an inbox and
 * leaves you to find the thread it was telling you about, which on a portal
 * where a parent has one conversation per teacher is a small search every time.
 *
 * It is also the **dedupe key**: two entries for one conversation are two rows
 * with the same `href`, so `href` is what the conditional update matches on and
 * no extra column is needed to hold a key that was already in the row.
 */
export function chatPortalHref(role: UserRole, conversationId: string): string {
  const base =
    role === 'parent'
      ? '/parent/chat'
      : role === 'student'
        ? '/student/chat'
        : role === 'teacher'
          ? '/teacher/chat'
          : '/dashboard/chat';

  return `${base}?conversation=${encodeURIComponent(conversationId)}`;
}

export interface ChatNotificationRecipient {
  schoolUserId: string;
  role: UserRole;
}

export interface ChatNotificationInput {
  locationId: string;
  conversationId: string;
  /** Who wrote it. Shown in the entry's title; never the message body. */
  senderName: string;
  /** The thread's subject, when it has one. Null becomes a plain sentence. */
  subject: string | null;
  recipients: readonly ChatNotificationRecipient[];
}

/**
 * Writes or refreshes one bell entry per recipient.
 *
 * Never throws at its caller. A message that reached the transcript and the
 * signal table has been delivered; a bell row that could not be written is a
 * missing badge, and failing the send over it would turn a cosmetic fault into
 * a message the sender was told did not go. That is the same posture `notify()`
 * takes and the same one the announcement bell learned the hard way in §5bq.
 */
export async function notifyChatRecipients(input: ChatNotificationInput): Promise<void> {
  const title = `New message from ${input.senderName}`;
  const body =
    input.subject === null || input.subject.trim() === ''
      ? 'Open Messages to read it.'
      : input.subject.trim();

  for (const recipient of input.recipients) {
    const href = chatPortalHref(recipient.role, input.conversationId);

    try {
      /*
       * The claim. `read_at IS NULL` is what keeps this to the entry the
       * recipient has not looked at yet: once they have opened the bell, the
       * next message is a new event and deserves to raise the badge again.
       */
      const bumped = await db
        .update(notifications)
        .set({ title, body, createdAt: new Date() })
        .where(
          and(
            eq(notifications.audience, 'school_user'),
            eq(notifications.schoolUserId, recipient.schoolUserId),
            eq(notifications.kind, CHAT_NOTIFICATION_KIND),
            eq(notifications.href, href),
            isNull(notifications.readAt),
          ),
        )
        .returning({ id: notifications.id });

      if (bumped.length > 0) continue;

      await db.insert(notifications).values({
        audience: 'school_user',
        locationId: input.locationId,
        schoolUserId: recipient.schoolUserId,
        kind: CHAT_NOTIFICATION_KIND,
        title,
        body,
        href,
      });
    } catch (error) {
      console.error(
        `[chat] could not write the bell entry for ${recipient.schoolUserId}:`,
        error,
      );
    }
  }
}

/**
 * Clears the bell entries for one conversation the moment it is opened.
 *
 * Without this the badge is a number that only goes up: a parent who reads a
 * thread on the chat screen has plainly seen it, and an entry still sitting in
 * the bell saying so is the thing that teaches people the bell is wrong. The
 * bell's own "opening it marks everything read" rule is the same argument
 * applied from the other side.
 *
 * Scoped by recipient, so nothing here can clear anybody else's.
 */
export async function markChatNotificationsRead(
  schoolUserId: string,
  role: UserRole,
  conversationId: string,
): Promise<number> {
  const href = chatPortalHref(role, conversationId);

  const updated = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.audience, 'school_user'),
        eq(notifications.schoolUserId, schoolUserId),
        eq(notifications.kind, CHAT_NOTIFICATION_KIND),
        eq(notifications.href, href),
        isNull(notifications.readAt),
      ),
    )
    .returning({ id: notifications.id });

  return updated.length;
}
