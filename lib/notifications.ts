import 'server-only';

import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { notifications, type NotificationAudience } from '@/db/schema';

import { db } from './drizzle';
import { enqueueEmail } from './email-outbox';
import { serverEnv } from './env';

/**
 * The in-app bell, and the email that goes with it.
 *
 * ── One call writes both, on purpose ─────────────────────────────────────
 * Every notification in this product is "a thing happened, tell somebody", and
 * every one of them wants the bell *and* the mail. Two calls at each site is
 * two chances to write one and forget the other, and the one that gets
 * forgotten is always the mail — because the bell is the one you can see while
 * developing. So `notify()` is the door, exactly as `postTransaction` is the
 * only door to the ledger.
 *
 * ── The email is fired and not awaited for its delivery ──────────────────
 * `enqueueEmail` writes a row and returns in milliseconds; the drainer in
 * `instrumentation.ts` does the SMTP. That is the whole point of the outbox and
 * why a feedback submission returns fast even when the mail host is refusing.
 * The INSERT itself *is* awaited — an unqueued message is a message that will
 * never be sent, and swallowing that would be the announcement bug in a new
 * costume.
 *
 * ── A failed notification never fails the thing that caused it ───────────
 * A school pressing "Send feedback" has written a ticket; if the bell row or
 * the outbox row cannot be written, the ticket is still theirs and still
 * reached us. So this throws nothing at its caller. It logs, loudly, with the
 * kind and the recipient in the line — which is the difference between an
 * operator finding this in a log and an operator never knowing.
 */

export interface NotifyInput {
  audience: NotificationAudience;
  /** The school this concerns. Null only for platform mail about nothing. */
  locationId: string | null;
  /** Required for `school_user`, and refused for `super_admin`. */
  schoolUserId?: string | null;
  kind: string;
  title: string;
  body: string;
  /** Where the bell entry links to, within the recipient's own portal. */
  href: string;
  /**
   * Who to email. Null sends no mail and writes only the bell entry — which is
   * the right answer for a school member with no address on file, not a reason
   * to skip the notification entirely.
   */
  email: string | null;
  /** Subject line. Defaults to the title, prefixed with the product name. */
  emailSubject?: string;
  /** Body of the mail. Defaults to the notification body plus the link. */
  emailText?: string;
}

/**
 * The platform owner's address.
 *
 * `SUPER_ADMIN_EMAIL` is the same variable the login checks against, so there
 * is exactly one platform identity and no second list to keep in step. Absent
 * in a development environment that has never configured one, in which case the
 * bell entry is still written and the mail is skipped with a line in the log —
 * a notification nobody can see is a worse failure than a mail nobody sends.
 */
export function platformOwnerEmail(): string | null {
  const value = serverEnv('SUPER_ADMIN_EMAIL', '').trim();
  return value === '' ? null : value;
}

/** Absolute link for an email, when the deployment knows its own address. */
function absoluteLink(href: string): string {
  const base = serverEnv('INVITE_LINK_BASE_URL', '').trim().replace(/\/+$/, '');
  return base === '' ? href : `${base}${href}`;
}

export async function notify(input: NotifyInput): Promise<void> {
  const schoolUserId = input.audience === 'school_user' ? (input.schoolUserId ?? null) : null;

  if (input.audience === 'school_user' && schoolUserId === null) {
    console.error(
      `[notifications] refusing a school_user notification (${input.kind}) with no recipient`,
    );
    return;
  }

  try {
    await db.insert(notifications).values({
      audience: input.audience,
      locationId: input.locationId,
      schoolUserId,
      kind: input.kind,
      title: input.title,
      body: input.body,
      href: input.href,
    });
  } catch (error) {
    console.error(
      `[notifications] could not write the ${input.kind} notification:`,
      error,
    );
  }

  if (input.email === null || input.email.trim() === '') {
    console.info(`[notifications] ${input.kind}: no address on file, bell only`);
    return;
  }

  try {
    await enqueueEmail({
      // Platform mail about a school still carries that school's id, so the
      // outbox can be read per tenant — see §5ba's note about rows written
      // before that column was populated.
      locationId: input.locationId,
      to: input.email,
      subject: input.emailSubject ?? `${input.title} · SMS Platform`,
      text: input.emailText ?? `${input.body}\n\n${absoluteLink(input.href)}\n`,
    });
  } catch (error) {
    console.error(`[notifications] could not queue the ${input.kind} email:`, error);
  }
}

export interface NotificationRow {
  id: string;
  kind: string;
  title: string;
  body: string;
  href: string;
  readAt: Date | null;
  createdAt: Date;
}

/**
 * The bell's contents for one recipient.
 *
 * Capped rather than paged. A bell is a glance at what is new, and a person who
 * wants the whole history of a thing goes to the thing — which is why every row
 * carries an `href`. Twenty is what fits in a panel without becoming a screen.
 */
export async function listNotifications(
  recipient: { audience: 'super_admin' } | { audience: 'school_user'; schoolUserId: string },
  limit = 20,
): Promise<NotificationRow[]> {
  const where =
    recipient.audience === 'super_admin'
      ? eq(notifications.audience, 'super_admin')
      : and(
          eq(notifications.audience, 'school_user'),
          eq(notifications.schoolUserId, recipient.schoolUserId),
        );

  const rows = await db
    .select({
      id: notifications.id,
      kind: notifications.kind,
      title: notifications.title,
      body: notifications.body,
      href: notifications.href,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(where)
    .orderBy(desc(notifications.createdAt))
    .limit(limit);

  return rows;
}

/** How many are unread. One indexed count; safe to call from a layout. */
export async function countUnreadNotifications(
  recipient: { audience: 'super_admin' } | { audience: 'school_user'; schoolUserId: string },
): Promise<number> {
  const where =
    recipient.audience === 'super_admin'
      ? and(eq(notifications.audience, 'super_admin'), isNull(notifications.readAt))
      : and(
          eq(notifications.audience, 'school_user'),
          eq(notifications.schoolUserId, recipient.schoolUserId),
          isNull(notifications.readAt),
        );

  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(where);

  return row?.count ?? 0;
}

/**
 * Marks everything the recipient can see as read.
 *
 * Scoped by the same predicate the listing uses rather than by a list of ids
 * off the wire: an id in a request body is untrusted, and "mark all read" that
 * took one would let anybody clear anybody's bell. `read_at IS NULL` in the
 * WHERE keeps the timestamp of the first read rather than moving it.
 */
export async function markNotificationsRead(
  recipient: { audience: 'super_admin' } | { audience: 'school_user'; schoolUserId: string },
): Promise<number> {
  const where =
    recipient.audience === 'super_admin'
      ? and(eq(notifications.audience, 'super_admin'), isNull(notifications.readAt))
      : and(
          eq(notifications.audience, 'school_user'),
          eq(notifications.schoolUserId, recipient.schoolUserId),
          isNull(notifications.readAt),
        );

  const updated = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(where)
    .returning({ id: notifications.id });

  return updated.length;
}
