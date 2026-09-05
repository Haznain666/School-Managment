import 'server-only';

import { and, count, desc, eq, inArray, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';

import {
  announcementReads,
  announcementRecipients,
  announcements,
  branches,
  notifications,
  schoolUsers,
  type AnnouncementAudience,
  type AnnouncementStatus,
  type DeliveryChannel,
  type DeliveryStatus,
} from '@/db/schema';

import {
  parseAudience,
  resolveAudience,
  type AudienceMember,
} from './announcement-audience';
import { db } from './drizzle';
import { enqueueEmail } from './email-outbox';
import { filterByEmailPreference } from './notification-preferences';
import { getSchoolByLocationId } from './schools';
import { isUuid, readString } from './validation';

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

/**
 * Validates a request body into an `AnnouncementInput`, or the message to show.
 *
 * Here rather than in the route because both the create and the edit path need
 * it, and a Next route module may only export its handlers — an exported helper
 * there is a build error, not a style question.
 */
export function parseAnnouncementInput(raw: unknown): AnnouncementInput | string {
  if (typeof raw !== 'object' || raw === null) return 'Expected a JSON body.';
  const body = raw as Record<string, unknown>;

  const title = readString(body['title']);
  if (title === '' || title.length > 140) {
    return 'Enter a title of 140 characters or fewer.';
  }

  const text = readString(body['body']);
  if (text === '' || text.length > 5000) {
    return 'Enter a message of 5,000 characters or fewer.';
  }

  const audience = parseAudience(body['audience']);
  if (typeof audience === 'string') return audience;

  const rawBranch = body['branchId'];
  const branchId =
    rawBranch === undefined || rawBranch === null || rawBranch === '' ? null : rawBranch;
  if (branchId !== null && !isUuid(branchId)) {
    return 'Choose a campus, or all of them.';
  }

  let scheduledAt: Date | null = null;
  const rawWhen = body['scheduledAt'];
  if (rawWhen !== undefined && rawWhen !== null && rawWhen !== '') {
    if (typeof rawWhen !== 'string') return 'Choose when to send it.';
    const when = new Date(rawWhen);
    if (Number.isNaN(when.getTime())) return 'Choose when to send it.';
    scheduledAt = when;
  }

  return {
    title,
    body: text,
    audience,
    branchId,
    sendEmail: body['sendEmail'] === true,
    scheduledAt,
  };
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
  /**
   * People who have asked not to receive these by email (Sprint 13).
   *
   * Kept apart from `unreachable` for the same reason `unreachable` is kept
   * apart from `failed`: they have different owners. A missing address is the
   * school's to fix; a preference is the parent's, and is not a problem at all.
   * Their notice is on the board either way.
   */
  optedOut: number;
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

  const sentAt = new Date();

  /*
   * Claim the row before doing any work, in one atomic statement.
   *
   * ── Why a read-then-check was not enough ───────────────────────────────
   * It used to be `if (announcement.status === 'sent') return null`, which is
   * a read and a decision with a gap between them. The production log on
   * 2026-08-20 showed the sweep running at **seven** distinct offsets within
   * the same minute — seven Node processes, each started by
   * `instrumentation.ts`, each holding its own 60-second timer. Every one of
   * them would have read `scheduled`, passed that check, and queued a full
   * email run: seven copies of one notice to every parent in the school.
   *
   * Nothing downstream would have stopped it. The notice rows de-duplicate on
   * a unique key, but `email_outbox` has none — an announcement email is a
   * row, not an upsert, so seven runs are seven emails.
   *
   * `UPDATE … WHERE status <> 'sent' RETURNING id` is decided by Postgres on
   * one row under one lock. Exactly one caller gets a row back; the other six
   * get nothing and return null, which is what they already do for an
   * announcement that was sent a moment ago.
   */
  const claimed = await db
    .update(announcements)
    .set({ status: 'sent', sentAt, updatedAt: sentAt })
    .where(
      and(
        eq(announcements.locationId, locationId),
        eq(announcements.id, announcementId),
        ne(announcements.status, 'sent'),
      ),
    )
    .returning({ id: announcements.id });

  if (claimed.length === 0) return null;

  try {
    return await deliverAnnouncement(locationId, announcement);
  } catch (caught) {
    /*
     * Hand the announcement back, so the next sweep retries it.
     *
     * The claim above moved it to `sent` before the work was done, which is
     * what makes the claim atomic — and would otherwise turn a transient
     * failure into an announcement the school believes went out and nobody
     * received. Reverting restores the pre-2026-08-20 behaviour the scheduler
     * documents and relies on: a failed send is left where the next sweep will
     * find it.
     *
     * A revert that itself fails is swallowed rather than replacing the real
     * error, which is the one worth reading.
     */
    await db
      .update(announcements)
      .set({ status: announcement.status, sentAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(announcements.locationId, locationId),
          eq(announcements.id, announcementId),
        ),
      )
      .catch(() => undefined);

    throw caught;
  }
}

/**
 * Where a bell notification about an announcement takes each role.
 *
 * Four portals, four notice boards. A teacher sent to `/parent/announcements`
 * is bounced by the guard to their own home route, which reads as a link that
 * does nothing — the failure is silent and the fix is this map.
 *
 * `role` arrives as a plain string from `school_users.role`, deliberately not
 * narrowed — `AudienceMember` says why — so an unknown value falls through to
 * the admin board rather than producing an empty `href`, which the column
 * refuses.
 */
function noticeHrefFor(role: string): string {
  if (role === 'teacher') return '/teacher/announcements';
  if (role === 'parent') return '/parent/announcements';
  if (role === 'student') return '/student/announcements';
  return '/dashboard/communications';
}

/** The work of a send, once this process has established that it owns it. */
async function deliverAnnouncement(
  locationId: string,
  announcement: AnnouncementRow,
): Promise<SendOutcome> {
  const announcementId = announcement.id;

  const members = await resolveAudience(
    locationId,
    announcement.audience,
    announcement.branchId,
  );

  let queued = 0;
  let unreachable = 0;
  let optedOut = 0;

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

  /*
   * The bell — Sprint 27, item B8.
   *
   * ── What was broken, and for how long ──────────────────────────────────
   * Everything above this line writes `announcement_recipients` and the notice
   * board. Nothing has ever written `notifications`, so the bell in every
   * portal header — which `NotificationBell` renders and polls, and which every
   * portal layout already passes an unread count to — has not moved for an
   * announcement since Sprint 11. It was correct and empty, which is the worst
   * combination: nothing to find, nothing to fix, and a notice board nobody
   * knew had anything new on it.
   *
   * One bulk insert, not `notify()` per member. `notify` also sends an email,
   * and the email run below is what sends this announcement's — calling it here
   * would double every message a school sends.
   *
   * Never fails the send. An announcement whose notice rows are written and
   * whose bell rows are not is a degraded outcome; one that throws here after
   * claiming the row is an announcement the school believes went out. The
   * failure is logged and the send stands.
   */
  if (members.length > 0) {
    await db
      .insert(notifications)
      .values(
        members.map((member) => ({
          audience: 'school_user' as const,
          locationId,
          schoolUserId: member.schoolUserId,
          kind: 'announcement',
          title: announcement.title,
          // The first line of the notice, not the whole of it. The bell is a
          // list of one-liners; the notice board is where it is read.
          body: announcement.body.slice(0, 200),
          href: noticeHrefFor(member.role),
        })),
      )
      .catch((error: unknown) => {
        console.error(
          `[announcements] bell rows not written for ${announcementId}:`,
          error,
        );
      });
  }

  if (announcement.sendEmail) {
    const outcome = await queueEmailRun(locationId, announcement, members);
    queued = outcome.queued;
    unreachable = outcome.unreachable;
    optedOut = outcome.optedOut;
  }

  // The status was already written by the claim above — see `sendAnnouncement`.
  // Writing it again here would be harmless and misleading: it would suggest
  // the row is marked sent at the end of the work, which is exactly the
  // read-then-write this was changed to stop being.
  return { recipients: members.length, queued, unreachable, optedOut };
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
): Promise<{ queued: number; unreachable: number; optedOut: number }> {
  const school = await getSchoolByLocationId(locationId).catch(() => null);
  const schoolName = school?.schoolName ?? null;

  // Sprint 13 — whoever has switched off announcement email gets no email row.
  //
  // Skipped rather than logged as `unreachable`: that status means "the school
  // has no way to reach this person and should fix it", and an office chasing
  // a parent who deliberately opted out would be chasing the wrong thing. One
  // indexed read for the whole audience, never one per member.
  const wantsEmail = await filterByEmailPreference(
    locationId,
    members.map((member) => member.schoolUserId),
    'announcements',
  );

  let optedOut = 0;

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
    if (!wantsEmail.has(member.schoolUserId)) {
      optedOut += 1;
      continue;
    }

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
    optedOut,
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
        /*
         * `lte(column, date)`, never sql`${column} <= ${date}`.
         *
         * This line was the second form from Sprint 11 until 2026-08-20, and
         * every sweep it ran threw before touching a row:
         *
         *   The "string" argument must be of type string or an instance of
         *   Buffer or ArrayBuffer. Received an instance of Date
         *
         * A raw `sql` template is the one place Drizzle has no column type to
         * work from, so it passes the JavaScript value straight to postgres-js.
         * `lte` goes through `PgTimestamp.mapToDriverValue`, which turns the
         * Date into the ISO string the driver wants. Same SQL, same plan — the
         * parameter is `"2026-08-20T18:42:48.447Z"` instead of a `Date`, and
         * that is the whole difference between this working and not.
         *
         * The failure is invisible in development because nothing schedules an
         * announcement there, and total in production: not one scheduled
         * announcement had ever been released.
         */
        or(isNull(announcements.scheduledAt), lte(announcements.scheduledAt, now)),
      ),
    )
    .limit(50);
}
