import 'server-only';

import { and, count, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';

import {
  announcementReads,
  announcementRecipients,
  announcements,
  branches,
  schoolUsers,
  type AnnouncementAudience,
  type AnnouncementStatus,
  type DeliveryChannel,
  type DeliveryStatus,
} from '@/db/schema';

import { resolveAudience, type AudienceMember } from './announcement-audience';
import { isWhatsAppEnabled } from './channels';
import { db } from './drizzle';
import { enqueueEmail } from './email-outbox';
import { getSchoolByLocationId } from './schools';

/**
 * Tenant-scoped reads and writes for announcements.
 *
 * Same contract as the other query modules: `locationId` is the first argument
 * of every function and comes from verified session claims, never from a
 * request body, so an id an attacker controls can only narrow a read.
 *
 * ── The two audiences of this file ───────────────────────────────────────
 * The management screens are behind `comms.*` and see everything, including
 * drafts. The notice board on the four portals is behind no permission at all —
 * it is reached by uid, exactly as the student and parent portals already read
 * their own data — and it can only ever see announcements that are *sent* and
 * that the reader is in the audience of. Those two paths are kept visibly
 * separate below rather than sharing a filtered helper, because the day they
 * share one is the day a draft appears on a parent's phone.
 */

/* -----------------------------------------------------------------------------
 * Management reads.
 * -------------------------------------------------------------------------- */

export interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  audience: AnnouncementAudience;
  branchId: string | null;
  branchName: string | null;
  status: AnnouncementStatus;
  sendEmail: boolean;
  scheduledAt: Date | null;
  sentAt: Date | null;
  authorName: string | null;
  createdAt: Date;
  /** People the delivery log says this went to. Zero until it is sent. */
  recipientCount: number;
}

const ANNOUNCEMENT_COLUMNS = {
  id: announcements.id,
  title: announcements.title,
  body: announcements.body,
  audience: announcements.audience,
  branchId: announcements.branchId,
  branchName: branches.name,
  status: announcements.status,
  sendEmail: announcements.sendEmail,
  scheduledAt: announcements.scheduledAt,
  sentAt: announcements.sentAt,
  authorName: schoolUsers.name,
  createdAt: announcements.createdAt,
} as const;

export async function listAnnouncements(
  locationId: string,
  filters: { status?: AnnouncementStatus | undefined; branchId?: string | undefined } = {},
): Promise<AnnouncementRow[]> {
  const conditions: SQL[] = [eq(announcements.locationId, locationId)];
  if (filters.status !== undefined) {
    conditions.push(eq(announcements.status, filters.status));
  }
  if (filters.branchId !== undefined && filters.branchId !== '') {
    conditions.push(eq(announcements.branchId, filters.branchId));
  }

  return db
    .select({
      ...ANNOUNCEMENT_COLUMNS,
      recipientCount: sql<number>`count(distinct ${announcementRecipients.schoolUserId})`.mapWith(
        Number,
      ),
    })
    .from(announcements)
    .leftJoin(branches, eq(branches.id, announcements.branchId))
    .leftJoin(schoolUsers, eq(schoolUsers.id, announcements.createdBy))
    .leftJoin(
      announcementRecipients,
      and(
        eq(announcementRecipients.announcementId, announcements.id),
        // The join carries the tenant filter too. A join predicate that omits
        // it is how a scoped query stops being scoped.
        eq(announcementRecipients.locationId, locationId),
      ),
    )
    .where(and(...conditions))
    .groupBy(announcements.id, branches.name, schoolUsers.name)
    // Newest first, and a draft with no dates sorts by when it was written.
    .orderBy(desc(announcements.createdAt));
}

export async function getAnnouncement(
  locationId: string,
  announcementId: string,
): Promise<AnnouncementRow | null> {
  const rows = await db
    .select({ ...ANNOUNCEMENT_COLUMNS, recipientCount: sql<number>`0`.mapWith(Number) })
    .from(announcements)
    .leftJoin(branches, eq(branches.id, announcements.branchId))
    .leftJoin(schoolUsers, eq(schoolUsers.id, announcements.createdBy))
    .where(and(eq(announcements.locationId, locationId), eq(announcements.id, announcementId)))
    .limit(1);

  return rows[0] ?? null;
}

/* -----------------------------------------------------------------------------
 * Writes.
 * -------------------------------------------------------------------------- */

export interface AnnouncementInput {
  title: string;
  body: string;
  audience: AnnouncementAudience;
  branchId: string | null;
  sendEmail: boolean;
  scheduledAt: Date | null;
}

export async function createAnnouncement(
  locationId: string,
  input: AnnouncementInput,
  createdBy: string | null,
): Promise<string | null> {
  const inserted = await db
    .insert(announcements)
    .values({
      locationId,
      title: input.title,
      body: input.body,
      audience: input.audience,
      branchId: input.branchId,
      sendEmail: input.sendEmail,
      scheduledAt: input.scheduledAt,
      status: input.scheduledAt === null ? 'draft' : 'scheduled',
      createdBy,
    })
    .returning({ id: announcements.id });

  return inserted[0]?.id ?? null;
}

/**
 * Edits an announcement that has not been sent.
 *
 * A sent announcement is deliberately not editable. People have already read
 * it, some of them in an email that cannot be recalled, and a notice board that
 * silently disagreed with the email a parent is holding is worse than a second
 * notice correcting the first.
 */
export async function updateAnnouncement(
  locationId: string,
  announcementId: string,
  input: AnnouncementInput,
): Promise<boolean> {
  const updated = await db
    .update(announcements)
    .set({
      title: input.title,
      body: input.body,
      audience: input.audience,
      branchId: input.branchId,
      sendEmail: input.sendEmail,
      scheduledAt: input.scheduledAt,
      status: input.scheduledAt === null ? 'draft' : 'scheduled',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(announcements.locationId, locationId),
        eq(announcements.id, announcementId),
        inArray(announcements.status, ['draft', 'scheduled']),
      ),
    )
    .returning({ id: announcements.id });

  return updated.length > 0;
}

export async function deleteAnnouncement(
  locationId: string,
  announcementId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(announcements)
    .where(
      and(
        eq(announcements.locationId, locationId),
        eq(announcements.id, announcementId),
        // A sent announcement is a record of something the school told people.
        // Deleting it would erase the delivery log that answers "did we tell
        // the parents", which is the question this table exists for.
        inArray(announcements.status, ['draft', 'scheduled']),
      ),
    )
    .returning({ id: announcements.id });

  return deleted.length > 0;
}

/* -----------------------------------------------------------------------------
 * Sending.
 * -------------------------------------------------------------------------- */

export interface SendOutcome {
  /** People the notice now reaches. */
  recipients: number;
  /** Emails accepted into the outbox. */
  queued: number;
  /** People with no address, when email was asked for. */
  unreachable: number;
}

/**
 * Puts an announcement on the notice board, and queues its email run.
 *
 * ── Why the email is queued and not sent ─────────────────────────────────
 * `STATE.md` §5k measured one `sendMail` at ~103 seconds. A campaign to four
 * hundred families cannot run inside a request at any speed, so this writes
 * outbox rows and returns, and `lib/email-outbox.ts` drains them. The screen
 * therefore says "queued", never "sent" — a screen that reports delivery it
 * cannot know about is the lie the outbox was built to stop telling.
 *
 * ── Why the delivery log is written here and never recomputed ────────────
 * The rows record the audience *as it was at this moment*. Resolving it again
 * later to answer "who did we tell" would give a different answer as soon as a
 * child changed section, and that question is only ever asked after something
 * has gone wrong.
 *
 * The notice rows are written even for a school that sends no email at all, so
 * the delivery report answers "how many people can see this" rather than being
 * empty.
 */
export async function sendAnnouncement(
  locationId: string,
  announcementId: string,
): Promise<SendOutcome | null> {
  const announcement = await getAnnouncement(locationId, announcementId);
  if (announcement === null) return null;
  // Sending twice would queue a second email to everyone who already has one.
  if (announcement.status === 'sent') return null;

  const members = await resolveAudience(
    locationId,
    announcement.audience,
    announcement.branchId,
  );

  const sentAt = new Date();
  let queued = 0;
  let unreachable = 0;

  if (members.length > 0) {
    await db
      .insert(announcementRecipients)
      .values(
        members.map((member) => ({
          locationId,
          announcementId,
          schoolUserId: member.schoolUserId,
          channel: 'notice' as DeliveryChannel,
          status: 'sent' as DeliveryStatus,
        })),
      )
      // A re-send after a partial failure must correct the same rows rather
      // than claim the same delivery twice.
      .onConflictDoNothing();
  }

  if (announcement.sendEmail) {
    const outcome = await queueEmailRun(locationId, announcement, members);
    queued = outcome.queued;
    unreachable = outcome.unreachable;
  }

  await db
    .update(announcements)
    .set({ status: 'sent', sentAt, updatedAt: sentAt })
    .where(and(eq(announcements.locationId, locationId), eq(announcements.id, announcementId)));

  return { recipients: members.length, queued, unreachable };
}

/**
 * Queues one email per reachable member, and logs the rest as unreachable.
 *
 * Each message is enqueued in its own try/catch. One address the queue refuses
 * must not abandon the other three hundred, and the delivery log is where that
 * one is reported rather than a thrown request the sender reads as "nothing was
 * sent".
 */
async function queueEmailRun(
  locationId: string,
  announcement: AnnouncementRow,
  members: readonly AudienceMember[],
): Promise<{ queued: number; unreachable: number }> {
  const school = await getSchoolByLocationId(locationId).catch(() => null);
  const schoolName = school?.schoolName ?? null;

  const rows: Array<{
    locationId: string;
    announcementId: string;
    schoolUserId: string;
    channel: DeliveryChannel;
    status: DeliveryStatus;
    detail: string | null;
    outboxId: string | null;
  }> = [];

  for (const member of members) {
    const address = member.email?.trim() ?? '';

    if (address === '') {
      rows.push({
        locationId,
        announcementId: announcement.id,
        schoolUserId: member.schoolUserId,
        channel: 'email',
        status: 'unreachable',
        // Words an office can act on, not a code.
        detail: 'No email address on their record',
        outboxId: null,
      });
      continue;
    }

    try {
      const outboxId = await enqueueEmail({
        locationId,
        to: address,
        subject: announcement.title,
        text: emailBody(announcement, schoolName),
      });

      rows.push({
        locationId,
        announcementId: announcement.id,
        schoolUserId: member.schoolUserId,
        channel: 'email',
        status: 'queued',
        detail: null,
        outboxId,
      });
    } catch (caught) {
      rows.push({
        locationId,
        announcementId: announcement.id,
        schoolUserId: member.schoolUserId,
        channel: 'email',
        status: 'failed',
        detail: caught instanceof Error ? caught.message : 'Could not be queued',
        outboxId: null,
      });
    }
  }

  if (rows.length > 0) {
    await db.insert(announcementRecipients).values(rows).onConflictDoNothing();
  }

  return {
    queued: rows.filter((row) => row.status === 'queued').length,
    unreachable: rows.filter((row) => row.status === 'unreachable').length,
  };
}

/**
 * The message body.
 *
 * Plain text, because `lib/email-sender.ts` sends plain text and the outbox
 * carries one body column — a body whose meaning depended on a sibling format
 * column is how a queue starts sending markup to people. The school's name is
 * the letterhead: a parent who receives an unsigned notice cannot tell which of
 * their children's schools sent it.
 */
function emailBody(announcement: AnnouncementRow, schoolName: string | null): string {
  const signature = schoolName === null ? '' : `\n\n— ${schoolName}`;
  return `${announcement.body}${signature}`;
}

/* -----------------------------------------------------------------------------
 * The delivery log.
 * -------------------------------------------------------------------------- */

export interface DeliveryRow {
  schoolUserId: string;
  name: string;
  role: string;
  channel: DeliveryChannel;
  status: DeliveryStatus;
  detail: string | null;
}

export interface DeliveryReport {
  rows: DeliveryRow[];
  counts: Record<DeliveryStatus, number>;
  /** People on the notice board, whichever way the email went. */
  reached: number;
}

export async function getDeliveryReport(
  locationId: string,
  announcementId: string,
): Promise<DeliveryReport> {
  const rows = await db
    .select({
      schoolUserId: announcementRecipients.schoolUserId,
      name: schoolUsers.name,
      role: schoolUsers.role,
      channel: announcementRecipients.channel,
      status: announcementRecipients.status,
      detail: announcementRecipients.detail,
    })
    .from(announcementRecipients)
    .innerJoin(
      schoolUsers,
      and(
        eq(schoolUsers.id, announcementRecipients.schoolUserId),
        eq(schoolUsers.locationId, locationId),
      ),
    )
    .where(
      and(
        eq(announcementRecipients.locationId, locationId),
        eq(announcementRecipients.announcementId, announcementId),
      ),
    )
    .orderBy(schoolUsers.name);

  const counts: Record<DeliveryStatus, number> = {
    queued: 0,
    sent: 0,
    failed: 0,
    unreachable: 0,
  };

  for (const row of rows) counts[row.status] += 1;

  return {
    rows,
    counts,
    reached: rows.filter((row) => row.channel === 'notice').length,
  };
}

/* -----------------------------------------------------------------------------
 * The notice board — the only path a portal reads.
 * -------------------------------------------------------------------------- */

export interface NoticeRow {
  id: string;
  title: string;
  body: string;
  sentAt: Date | null;
  isRead: boolean;
}

/**
 * What one person can see, newest first.
 *
 * Reached from the delivery log rather than by re-resolving the audience: the
 * recipient rows are what the school actually sent, so a child who changed
 * section in May still sees the notice their old class was sent in April, and
 * never sees one addressed to a class they were not in at the time. Anything
 * else makes a notice board that rewrites its own history.
 *
 * Only `sent` announcements, and the status filter is on the row rather than
 * inferred from `sentAt`, so a schema change that ever allowed one without the
 * other cannot leak a draft.
 */
export async function listNoticesFor(
  locationId: string,
  schoolUserId: string,
  limit = 50,
): Promise<NoticeRow[]> {
  return db
    .select({
      id: announcements.id,
      title: announcements.title,
      body: announcements.body,
      sentAt: announcements.sentAt,
      isRead: sql<boolean>`${announcementReads.id} is not null`,
    })
    .from(announcementRecipients)
    .innerJoin(
      announcements,
      and(
        eq(announcements.id, announcementRecipients.announcementId),
        eq(announcements.locationId, locationId),
        eq(announcements.status, 'sent'),
      ),
    )
    .leftJoin(
      announcementReads,
      and(
        eq(announcementReads.announcementId, announcements.id),
        eq(announcementReads.schoolUserId, schoolUserId),
        eq(announcementReads.locationId, locationId),
      ),
    )
    .where(
      and(
        eq(announcementRecipients.locationId, locationId),
        eq(announcementRecipients.schoolUserId, schoolUserId),
        eq(announcementRecipients.channel, 'notice'),
      ),
    )
    .orderBy(desc(announcements.sentAt))
    .limit(limit);
}

/** How many notices this person has not opened. Drives the sidebar badge. */
export async function countUnreadNotices(
  locationId: string,
  schoolUserId: string,
): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(announcementRecipients)
    .innerJoin(
      announcements,
      and(
        eq(announcements.id, announcementRecipients.announcementId),
        eq(announcements.locationId, locationId),
        eq(announcements.status, 'sent'),
      ),
    )
    .leftJoin(
      announcementReads,
      and(
        eq(announcementReads.announcementId, announcements.id),
        eq(announcementReads.schoolUserId, schoolUserId),
        eq(announcementReads.locationId, locationId),
      ),
    )
    .where(
      and(
        eq(announcementRecipients.locationId, locationId),
        eq(announcementRecipients.schoolUserId, schoolUserId),
        eq(announcementRecipients.channel, 'notice'),
        isNull(announcementReads.id),
      ),
    );

  return rows[0]?.value ?? 0;
}

/**
 * Marks notices read for one person.
 *
 * Only ever marks what they were actually sent — the insert selects from the
 * delivery log rather than trusting the ids in the request, so a crafted body
 * cannot create a read marker against an announcement addressed to somebody
 * else. It is also idempotent, because a page that marks on view will be
 * opened twice.
 */
export async function markNoticesRead(
  locationId: string,
  schoolUserId: string,
  announcementIds: readonly string[],
): Promise<number> {
  if (announcementIds.length === 0) return 0;

  const mine = await db
    .select({ announcementId: announcementRecipients.announcementId })
    .from(announcementRecipients)
    .innerJoin(
      announcements,
      and(
        eq(announcements.id, announcementRecipients.announcementId),
        eq(announcements.locationId, locationId),
        eq(announcements.status, 'sent'),
      ),
    )
    .where(
      and(
        eq(announcementRecipients.locationId, locationId),
        eq(announcementRecipients.schoolUserId, schoolUserId),
        eq(announcementRecipients.channel, 'notice'),
        inArray(announcementRecipients.announcementId, [...announcementIds]),
      ),
    );

  if (mine.length === 0) return 0;

  const inserted = await db
    .insert(announcementReads)
    .values(
      mine.map((row) => ({
        locationId,
        announcementId: row.announcementId,
        schoolUserId,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: announcementReads.id });

  return inserted.length;
}

/* -----------------------------------------------------------------------------
 * Scheduling.
 * -------------------------------------------------------------------------- */

/**
 * Scheduled announcements whose time has come.
 *
 * There is no cron on Hostinger's shared plan, so this is called from the same
 * interval that drains the outbox. Reading it as "due at or before now" rather
 * than "due in the last N minutes" means a process that was down for an hour
 * sends the backlog when it returns instead of silently skipping it.
 */
export async function listDueAnnouncements(now: Date = new Date()): Promise<
  Array<{ locationId: string; id: string }>
> {
  return db
    .select({ locationId: announcements.locationId, id: announcements.id })
    .from(announcements)
    .where(
      and(
        eq(announcements.status, 'scheduled'),
        or(isNull(announcements.scheduledAt), sql`${announcements.scheduledAt} <= ${now}`),
      ),
    )
    .limit(50);
}

/**
 * Whether this school has the paid WhatsApp add-on on.
 *
 * Re-exported through `lib/channels.ts` rather than answered here, so the
 * announcement path and the fee-reminder path cannot come to different
 * conclusions about the same school.
 */
export async function whatsAppEnabled(locationId: string): Promise<boolean> {
  return isWhatsAppEnabled(locationId);
}
