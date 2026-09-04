import 'server-only';

import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import webpush from 'web-push';

import { chatConversations } from '@/db/schema/chat-conversations';
import { chatParticipants } from '@/db/schema/chat-participants';
import { chatSettings } from '@/db/schema/chat-settings';
import { MAX_PUSH_FAILURES, pushSubscriptions } from '@/db/schema/push-subscriptions';
import { schoolUsers } from '@/db/schema/school-users';

import { inQuietHours } from './chat-permissions';
import { db } from './drizzle';
import { filterByPushPreference } from './notification-preferences';

/**
 * Web Push — the thing that reaches a parent who has closed the portal.
 *
 * ── Why this is the feature chat was waiting for ─────────────────────────
 * `ROADMAP.md` states the risk plainly: chat replaces a channel parents *read*
 * — WhatsApp — with one they must remember to open, and *"if a fee reminder
 * sits unread in a chat inbox nobody opens, collections suffer"*. Sprint 24
 * shipped the hourly digest email as the hedge. This is the answer, and it is
 * why `ROADMAP.md` says do not build 24 and stop.
 *
 * ── The payload carries no message ──────────────────────────────────────
 * A push renders on a lock screen, in front of whoever happens to be holding
 * the phone. So it carries a sender's name, the words "sent you a message", and
 * a URL — and never a body, a subject, or a pupil's name.
 *
 * That is the same rule `chat_signals` is built on, applied where it matters
 * more. Opening the notification lands on the conversation, where
 * `withSchoolAuth` re-resolves membership on that request like every other read.
 *
 * ── A `410` is not a failure to retry ───────────────────────────────────
 * A push service answering `404` or `410 Gone` is telling you the browser is
 * gone: the PWA was deleted, site data was cleared, the subscription was
 * revoked. There is nothing to retry *to*, so the row is deleted immediately.
 *
 * `failure_count` exists for the other errors — a 500 from the push service, a
 * timeout — and a row that keeps failing is dropped by the sweep rather than
 * kept forever. Without that distinction a dead subscription is retried every
 * five minutes until the end of time.
 *
 * ── Never inside a request ──────────────────────────────────────────────
 * Sending talks to Google's and Mozilla's servers over the network. That
 * happens in the digest sweep, never on the path of somebody pressing Send —
 * the same rule `lib/email-outbox.ts` follows for SMTP, for the same reason.
 */

/** Whether the deployment can push at all. */
export function pushConfigured(): boolean {
  return (
    (process.env.VAPID_PUBLIC_KEY ?? '').trim() !== '' &&
    (process.env.VAPID_PRIVATE_KEY ?? '').trim() !== ''
  );
}

let configured = false;

function configure(): boolean {
  if (configured) return true;
  if (!pushConfigured()) return false;

  webpush.setVapidDetails(
    // A contact the push service can reach about a misbehaving sender. `mailto:`
    // is what the spec asks for; the address need not receive mail for the
    // subscription to work, and this one does.
    `mailto:${process.env.SMTP_FROM ?? 'noreply@codexmill.com'}`,
    (process.env.VAPID_PUBLIC_KEY ?? '').trim(),
    (process.env.VAPID_PRIVATE_KEY ?? '').trim(),
  );

  configured = true;
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  /** Collapses several notifications about one conversation into one. */
  tag: string;
}

/** Postgres status codes a push service uses to say "this browser is gone". */
const GONE_STATUSES = new Set([404, 410]);

/**
 * Sends one notification to one browser.
 *
 * Returns `'sent'`, `'gone'` (the row was deleted) or `'failed'`. Never throws:
 * a push that could not be delivered must not take down the sweep that was
 * delivering forty others.
 */
export async function sendToSubscription(
  subscription: {
    id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
  },
  payload: PushPayload,
): Promise<'sent' | 'gone' | 'failed'> {
  if (!configure()) return 'failed';

  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload),
      { TTL: 60 * 60 },
    );

    await db
      .update(pushSubscriptions)
      .set({ lastSentAt: new Date(), failureCount: 0 })
      .where(eq(pushSubscriptions.id, subscription.id));

    return 'sent';
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;

    if (status !== undefined && GONE_STATUSES.has(status)) {
      // Nothing to retry to. See the docblock.
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, subscription.id));
      return 'gone';
    }

    await db
      .update(pushSubscriptions)
      .set({ failureCount: sql`${pushSubscriptions.failureCount} + 1` })
      .where(eq(pushSubscriptions.id, subscription.id));

    return 'failed';
  }
}

export interface PushCandidate {
  schoolUserId: string;
  locationId: string;
  name: string;
  quietHoursFrom: number | null;
  quietHoursTo: number | null;
}

/**
 * Everybody with something unread, for the push half of the sweep.
 *
 * Deliberately **not** joined to `push_subscriptions` here. A person with three
 * browsers would otherwise appear three times and be quiet-hours-checked and
 * preference-checked three times; the subscriptions are fetched per person once
 * they have passed both.
 */
export async function pushCandidates(limit = 200): Promise<PushCandidate[]> {
  const rows = await db
    .selectDistinct({
      schoolUserId: chatParticipants.schoolUserId,
      locationId: chatParticipants.locationId,
      name: schoolUsers.name,
      quietHoursFrom: chatSettings.quietHoursFrom,
      quietHoursTo: chatSettings.quietHoursTo,
    })
    .from(chatParticipants)
    .innerJoin(chatConversations, eq(chatConversations.id, chatParticipants.conversationId))
    .innerJoin(schoolUsers, eq(schoolUsers.id, chatParticipants.schoolUserId))
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
        or(
          isNull(chatParticipants.lastReadAt),
          lt(chatParticipants.lastReadAt, chatConversations.lastMessageAt),
        ),
      ),
    )
    .limit(limit);

  return rows;
}

/** Every browser registered to one person. */
export async function subscriptionsFor(
  locationId: string,
  schoolUserId: string,
): Promise<{ id: string; endpoint: string; p256dh: string; auth: string }[]> {
  return db
    .select({
      id: pushSubscriptions.id,
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.locationId, locationId),
        eq(pushSubscriptions.schoolUserId, schoolUserId),
      ),
    );
}

/**
 * Notifies everybody with something unread. Returns how many browsers were hit.
 *
 * Called from the digest sweep, which already runs every five minutes and
 * already claims per person — so this piggybacks on that cadence rather than
 * adding a fifth timer to `instrumentation.ts`.
 */
export async function sweepPushNotifications(now: Date = new Date()): Promise<number> {
  if (!pushConfigured()) return 0;

  let sent = 0;

  for (const person of await pushCandidates()) {
    // Quiet hours defer the *notification*, which is precisely what a push is.
    if (inQuietHours(now, person.quietHoursFrom, person.quietHoursTo)) continue;

    // `push_chat`, not `email_chat`. Somebody may want a buzz and not an email,
    // and one flag governing both makes that impossible to express.
    const allowed = await filterByPushPreference(person.locationId, [person.schoolUserId]);
    if (!allowed.has(person.schoolUserId)) continue;

    const subscriptions = await subscriptionsFor(person.locationId, person.schoolUserId);

    for (const subscription of subscriptions) {
      const result = await sendToSubscription(subscription, {
        title: 'New message',
        // No sender, no subject, no pupil's name. See the docblock.
        body: 'You have a new message at school.',
        url: '/',
        tag: 'chat',
      });
      if (result === 'sent') sent += 1;
    }
  }

  await dropExhaustedSubscriptions();

  return sent;
}

/** Removes rows that have failed too often for a reason that was not `410`. */
export async function dropExhaustedSubscriptions(): Promise<number> {
  const dropped = await db
    .delete(pushSubscriptions)
    .where(sql`${pushSubscriptions.failureCount} >= ${MAX_PUSH_FAILURES}`)
    .returning({ id: pushSubscriptions.id });

  return dropped.length;
}

/** Deletes every subscription for a person — used when an account is disabled. */
export async function clearSubscriptionsFor(
  locationId: string,
  schoolUserIds: readonly string[],
): Promise<void> {
  if (schoolUserIds.length === 0) return;

  await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.locationId, locationId),
        inArray(pushSubscriptions.schoolUserId, [...schoolUserIds]),
      ),
    );
}
