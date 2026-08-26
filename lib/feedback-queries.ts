import 'server-only';

import { and, asc, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';

import {
  feedbackAttachments,
  feedbackReplies,
  feedbackTickets,
  schools,
  type FeedbackAuthorKind,
  type FeedbackNature,
  type FeedbackStatus,
} from '@/db/schema';

import { db } from './drizzle';
import {
  FEEDBACK_SECTION_STATUSES,
  type FeedbackSection,
  type FeedbackSortColumn,
} from './feedback';
import { deleteObject } from './storage';

/**
 * Reads and writes over the feedback tables.
 *
 * ── Two audiences, two sets of functions, and no shared "list" ───────────
 * The school side is tenant-scoped and the platform side is deliberately not.
 * Writing one `listFeedback(locationId?)` with an optional tenant would put the
 * one query in the product whose safety depends on a parameter being present
 * behind a parameter that is allowed to be absent — and a caller that forgets
 * it does not fail, it succeeds and returns every school's tickets. Two
 * functions cannot be got wrong that way: `listSchoolFeedback` takes a
 * `locationId` it cannot do without, and `listPlatformFeedback` takes none and
 * says so in its name.
 */

export interface FeedbackAttachmentRow {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

export interface FeedbackReplyRow {
  id: string;
  authorKind: FeedbackAuthorKind;
  authorName: string;
  body: string;
  createdAt: Date;
}

export interface FeedbackListRow {
  id: string;
  title: string;
  nature: FeedbackNature;
  status: FeedbackStatus;
  createdAt: Date;
  statusChangedAt: Date | null;
  submittedByName: string;
  /** The school's own name, for the "Title – School name" the listing shows. */
  schoolName: string;
  locationId: string;
  attachmentCount: number;
  replyCount: number;
}

export interface FeedbackDetail extends FeedbackListRow {
  body: string;
  /** The account that wrote it, or null once it has been removed. */
  submittedBy: string | null;
  submittedByEmail: string;
  readAt: Date | null;
  attachments: FeedbackAttachmentRow[];
  replies: FeedbackReplyRow[];
}

/**
 * The counts beside each section title, when the operator turns them on.
 *
 * All four in one pass rather than four queries. `count(*) filter (…)` is one
 * of the handful of expressions with no Drizzle operator, which is exactly the
 * case CLAUDE.md reserves a raw `sql` template for — it interpolates no *value*,
 * only column references, so there is nothing here for `mapToDriverValue` to
 * have got wrong.
 */
export interface FeedbackSectionCounts {
  active: number;
  in_progress: number;
  future: number;
  resolved: number;
  /** Unread only — what the dashboard tile and the bell badge show. */
  unread: number;
}

export async function getFeedbackSectionCounts(): Promise<FeedbackSectionCounts> {
  const [row] = await db
    .select({
      active: sql<number>`count(*) filter (where ${feedbackTickets.status} in ('unread', 'read'))::int`,
      in_progress: sql<number>`count(*) filter (where ${feedbackTickets.status} = 'in_progress')::int`,
      future: sql<number>`count(*) filter (where ${feedbackTickets.status} = 'future')::int`,
      resolved: sql<number>`count(*) filter (where ${feedbackTickets.status} = 'resolved')::int`,
      unread: sql<number>`count(*) filter (where ${feedbackTickets.status} = 'unread')::int`,
    })
    .from(feedbackTickets);

  return (
    row ?? { active: 0, in_progress: 0, future: 0, resolved: 0, unread: 0 }
  );
}

/** Just the unread count, for the Super Admin dashboard tile. */
export async function countUnreadFeedback(): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(feedbackTickets)
    .where(eq(feedbackTickets.status, 'unread'));

  return row?.value ?? 0;
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                     */
/* -------------------------------------------------------------------------- */

export interface CreateFeedbackInput {
  locationId: string;
  submittedBy: string | null;
  submittedByName: string;
  submittedByEmail: string;
  title: string;
  body: string;
  nature: FeedbackNature;
  attachments: ReadonlyArray<{
    storagePath: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
  }>;
}

/**
 * Writes the ticket and its files in one transaction.
 *
 * The files are already in Storage by the time this runs — an object store is
 * not transactional and pretending otherwise would mean holding a database
 * transaction open across five network uploads. What this guarantees instead is
 * the direction that matters: there is never a ticket whose attachment rows are
 * missing. The opposite leak — an uploaded object with no row, because the
 * INSERT failed — costs a few kilobytes in a bucket and loses nobody anything.
 */
export async function createFeedbackTicket(
  input: CreateFeedbackInput,
): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    const [ticket] = await tx
      .insert(feedbackTickets)
      .values({
        locationId: input.locationId,
        submittedBy: input.submittedBy,
        submittedByName: input.submittedByName,
        submittedByEmail: input.submittedByEmail,
        title: input.title,
        body: input.body,
        nature: input.nature,
      })
      .returning({ id: feedbackTickets.id });

    if (ticket === undefined) {
      throw new Error('The feedback could not be saved.');
    }

    if (input.attachments.length > 0) {
      await tx.insert(feedbackAttachments).values(
        input.attachments.map((file) => ({
          ticketId: ticket.id,
          storagePath: file.storagePath,
          fileName: file.fileName,
          contentType: file.contentType,
          sizeBytes: file.sizeBytes,
        })),
      );
    }

    return { id: ticket.id };
  });
}

/**
 * Marks a ticket read, and answers whether this call is the one that did it.
 *
 * A conditional `UPDATE … RETURNING`, not a read followed by an `if`. This is
 * the rule CLAUDE.md states for background work and it applies here for the
 * same reason with a different actor: opening a ticket in two tabs, or a
 * double-clicked link, issues the same statement twice. Postgres decides it on
 * one row under one lock, so exactly one caller sees a row come back and the
 * "first read" timestamp is the first read rather than the last.
 */
export async function markFeedbackRead(ticketId: string): Promise<boolean> {
  const claimed = await db
    .update(feedbackTickets)
    .set({ status: 'read', readAt: new Date(), updatedAt: new Date() })
    .where(and(eq(feedbackTickets.id, ticketId), eq(feedbackTickets.status, 'unread')))
    .returning({ id: feedbackTickets.id });

  return claimed.length > 0;
}

export interface StatusChange {
  id: string;
  locationId: string;
  title: string;
  status: FeedbackStatus;
  submittedBy: string | null;
  submittedByEmail: string;
}

/**
 * Sets a decision on a ticket, and returns what is needed to tell the school.
 *
 * Returns null when the status is already what was asked for. That is not a
 * failure — it is a second click, or two operators agreeing — and treating it
 * as a change would send the school a second "your ticket is now Resolved"
 * email saying nothing new. The caller keys the notification off this returning
 * a row, which makes "notify exactly once per real change" a property of the
 * `UPDATE` rather than of anybody remembering.
 */
export async function setFeedbackStatus(
  ticketId: string,
  status: FeedbackStatus,
): Promise<StatusChange | null> {
  const now = new Date();

  const [changed] = await db
    .update(feedbackTickets)
    .set({
      status,
      statusChangedAt: now,
      updatedAt: now,
      /*
       * A decision implies it was read: a ticket decided straight off the
       * listing would otherwise keep a null `read_at` forever.
       *
       * `now()` rather than an interpolated timestamp. CLAUDE.md's rule is that
       * a value never reaches the driver through a raw `sql` template, and the
       * first cut of this line interpolated `now.toISOString()`. That happened
       * to work — it is already a string — which is precisely what makes it
       * dangerous: the next person to write `${now}` there gets
       * ERR_INVALID_ARG_TYPE and no column name to go on. There is no value
       * here now, only a function call, so there is nothing to get wrong.
       */
      readAt: sql`coalesce(${feedbackTickets.readAt}, now())`,
    })
    .where(
      and(
        eq(feedbackTickets.id, ticketId),
        sql`${feedbackTickets.status} <> ${status}`,
      ),
    )
    .returning({
      id: feedbackTickets.id,
      locationId: feedbackTickets.locationId,
      title: feedbackTickets.title,
      status: feedbackTickets.status,
      submittedBy: feedbackTickets.submittedBy,
      submittedByEmail: feedbackTickets.submittedByEmail,
    });

  return changed ?? null;
}

export interface AddReplyInput {
  ticketId: string;
  authorKind: FeedbackAuthorKind;
  authorSchoolUserId: string | null;
  authorName: string;
  body: string;
}

export async function addFeedbackReply(input: AddReplyInput): Promise<{ id: string }> {
  const [reply] = await db
    .insert(feedbackReplies)
    .values({
      ticketId: input.ticketId,
      authorKind: input.authorKind,
      authorSchoolUserId: input.authorSchoolUserId,
      authorName: input.authorName,
      body: input.body,
    })
    .returning({ id: feedbackReplies.id });

  if (reply === undefined) throw new Error('The reply could not be saved.');

  await db
    .update(feedbackTickets)
    .set({ updatedAt: new Date() })
    .where(eq(feedbackTickets.id, input.ticketId));

  return reply;
}

/**
 * Deletes a ticket, its replies and its files.
 *
 * The database rows go by cascade; the Storage objects do not, because nothing
 * in an object store knows about a foreign key. They are removed first and one
 * at a time, and a failure on any of them is logged rather than thrown: an
 * operator pressing Delete means "stop showing me this", and refusing because a
 * bucket was briefly unreachable leaves the ticket on the screen and the
 * operator with nothing to do about it. An orphaned object costs kilobytes.
 */
export async function deleteFeedbackTicket(ticketId: string): Promise<boolean> {
  const files = await db
    .select({ storagePath: feedbackAttachments.storagePath })
    .from(feedbackAttachments)
    .where(eq(feedbackAttachments.ticketId, ticketId));

  for (const file of files) {
    try {
      await deleteObject(file.storagePath);
    } catch (error) {
      console.error(`[feedback] could not remove ${file.storagePath}:`, error);
    }
  }

  const deleted = await db
    .delete(feedbackTickets)
    .where(eq(feedbackTickets.id, ticketId))
    .returning({ id: feedbackTickets.id });

  return deleted.length > 0;
}

/* -------------------------------------------------------------------------- */
/* Reading — the platform side                                                 */
/* -------------------------------------------------------------------------- */

export interface PlatformFeedbackFilters {
  section: FeedbackSection | null;
  nature: FeedbackNature | null;
  status: FeedbackStatus | null;
  locationId: string | null;
  search: string;
}

export interface PlatformFeedbackQuery extends PlatformFeedbackFilters {
  sort: FeedbackSortColumn;
  direction: 'asc' | 'desc';
  page: number;
  limit: number;
}

/**
 * Counts of attachments and replies, as correlated sub-selects.
 *
 * Sub-selects rather than two `LEFT JOIN … GROUP BY`s, for the reason §5ba
 * gives about scoped aggregates: the outer query keeps exactly the shape it
 * would have without them, so paging and sorting are unaffected by how many
 * files a ticket happens to carry. A join would multiply rows before the
 * `LIMIT` and quietly page wrongly.
 *
 * Both columns are qualified explicitly. A column interpolated into a raw
 * template renders *unqualified* when the outer query has a single table in its
 * FROM and qualified once a join is present — the trap §5av records, where five
 * correct-beside-a-join sub-selects became ambiguous bare names. This query has
 * a join, so `feedback_tickets.id` renders qualified; writing the sub-select's
 * own table out in full means the reading does not depend on that.
 */
const attachmentCount = sql<number>`(
  select count(*)::int from ${feedbackAttachments}
  where ${feedbackAttachments.ticketId} = ${feedbackTickets.id}
)`;

const replyCount = sql<number>`(
  select count(*)::int from ${feedbackReplies}
  where ${feedbackReplies.ticketId} = ${feedbackTickets.id}
)`;

function platformWhere(filters: PlatformFeedbackFilters) {
  const conditions = [];

  if (filters.section !== null) {
    conditions.push(
      inArray(feedbackTickets.status, [...FEEDBACK_SECTION_STATUSES[filters.section]]),
    );
  }

  // A status filter narrows within a section rather than replacing it: an
  // operator who picked "Active" and then "Unread" means both.
  if (filters.status !== null) {
    conditions.push(eq(feedbackTickets.status, filters.status));
  }

  if (filters.nature !== null) {
    conditions.push(eq(feedbackTickets.nature, filters.nature));
  }

  if (filters.locationId !== null) {
    conditions.push(eq(feedbackTickets.locationId, filters.locationId));
  }

  const term = filters.search.trim();
  if (term !== '') {
    const pattern = `%${term}%`;
    conditions.push(
      or(
        ilike(feedbackTickets.title, pattern),
        ilike(feedbackTickets.body, pattern),
        ilike(feedbackTickets.submittedByName, pattern),
        ilike(schools.name, pattern),
      ),
    );
  }

  return conditions.length === 0 ? undefined : and(...conditions);
}

function platformOrderBy(sort: FeedbackSortColumn, direction: 'asc' | 'desc') {
  const order = direction === 'asc' ? asc : desc;

  switch (sort) {
    case 'title':
      return [order(feedbackTickets.title)];
    case 'school':
      return [order(schools.name)];
    case 'nature':
      return [order(feedbackTickets.nature)];
    case 'status':
      return [order(feedbackTickets.status)];
    case 'createdAt':
    default:
      return [order(feedbackTickets.createdAt)];
  }
}

export interface PlatformFeedbackPage {
  rows: FeedbackListRow[];
  total: number;
}

export async function listPlatformFeedback(
  query: PlatformFeedbackQuery,
): Promise<PlatformFeedbackPage> {
  const where = platformWhere(query);

  const [rows, [totalRow]] = await Promise.all([
    db
      .select({
        id: feedbackTickets.id,
        title: feedbackTickets.title,
        nature: feedbackTickets.nature,
        status: feedbackTickets.status,
        createdAt: feedbackTickets.createdAt,
        statusChangedAt: feedbackTickets.statusChangedAt,
        submittedByName: feedbackTickets.submittedByName,
        schoolName: schools.name,
        locationId: feedbackTickets.locationId,
        attachmentCount,
        replyCount,
      })
      .from(feedbackTickets)
      .innerJoin(schools, eq(schools.locationId, feedbackTickets.locationId))
      .where(where)
      .orderBy(...platformOrderBy(query.sort, query.direction))
      .limit(query.limit)
      .offset((query.page - 1) * query.limit),
    db
      .select({ value: count() })
      .from(feedbackTickets)
      .innerJoin(schools, eq(schools.locationId, feedbackTickets.locationId))
      .where(where),
  ]);

  return { rows, total: totalRow?.value ?? 0 };
}

/** Every school that has ever sent feedback, for the listing's school filter. */
export async function listFeedbackSchools(): Promise<
  Array<{ locationId: string; name: string }>
> {
  return db
    .selectDistinct({ locationId: schools.locationId, name: schools.name })
    .from(feedbackTickets)
    .innerJoin(schools, eq(schools.locationId, feedbackTickets.locationId))
    .orderBy(asc(schools.name));
}

/* -------------------------------------------------------------------------- */
/* Reading — one ticket, and the school's own list                             */
/* -------------------------------------------------------------------------- */

/**
 * One ticket in full.
 *
 * `locationId` is optional and its absence is *the* difference between the two
 * callers: the platform route passes none because it may read any school's
 * ticket, and the school route passes its own verified tenant so that a ticket
 * id belonging to another school resolves to null rather than to somebody
 * else's bug report. Guessing a uuid is not the threat; a link forwarded
 * between two schools' administrators is.
 */
export async function getFeedbackTicket(
  ticketId: string,
  locationId?: string,
): Promise<FeedbackDetail | null> {
  const [ticket] = await db
    .select({
      id: feedbackTickets.id,
      title: feedbackTickets.title,
      body: feedbackTickets.body,
      nature: feedbackTickets.nature,
      status: feedbackTickets.status,
      createdAt: feedbackTickets.createdAt,
      statusChangedAt: feedbackTickets.statusChangedAt,
      readAt: feedbackTickets.readAt,
      submittedBy: feedbackTickets.submittedBy,
      submittedByName: feedbackTickets.submittedByName,
      submittedByEmail: feedbackTickets.submittedByEmail,
      schoolName: schools.name,
      locationId: feedbackTickets.locationId,
    })
    .from(feedbackTickets)
    .innerJoin(schools, eq(schools.locationId, feedbackTickets.locationId))
    .where(
      locationId === undefined
        ? eq(feedbackTickets.id, ticketId)
        : and(
            eq(feedbackTickets.id, ticketId),
            eq(feedbackTickets.locationId, locationId),
          ),
    )
    .limit(1);

  if (ticket === undefined) return null;

  const [attachments, replies] = await Promise.all([
    db
      .select({
        id: feedbackAttachments.id,
        fileName: feedbackAttachments.fileName,
        contentType: feedbackAttachments.contentType,
        sizeBytes: feedbackAttachments.sizeBytes,
      })
      .from(feedbackAttachments)
      .where(eq(feedbackAttachments.ticketId, ticketId))
      .orderBy(asc(feedbackAttachments.createdAt)),
    db
      .select({
        id: feedbackReplies.id,
        authorKind: feedbackReplies.authorKind,
        authorName: feedbackReplies.authorName,
        body: feedbackReplies.body,
        createdAt: feedbackReplies.createdAt,
      })
      .from(feedbackReplies)
      .where(eq(feedbackReplies.ticketId, ticketId))
      .orderBy(asc(feedbackReplies.createdAt)),
  ]);

  return {
    ...ticket,
    attachmentCount: attachments.length,
    replyCount: replies.length,
    attachments,
    replies,
  };
}

/**
 * One school's own tickets, newest first.
 *
 * Not paged. A school sends a handful of these a year — the whole list fits in
 * a browser several times over, and `DataTable` in client mode gives it search,
 * sorting and paging without a round trip per keystroke. That is the same
 * judgement §5bb made about `StaffManager`, for the same reason.
 */
export async function listSchoolFeedback(locationId: string): Promise<FeedbackListRow[]> {
  return db
    .select({
      id: feedbackTickets.id,
      title: feedbackTickets.title,
      nature: feedbackTickets.nature,
      status: feedbackTickets.status,
      createdAt: feedbackTickets.createdAt,
      statusChangedAt: feedbackTickets.statusChangedAt,
      submittedByName: feedbackTickets.submittedByName,
      schoolName: schools.name,
      locationId: feedbackTickets.locationId,
      attachmentCount,
      replyCount,
    })
    .from(feedbackTickets)
    .innerJoin(schools, eq(schools.locationId, feedbackTickets.locationId))
    .where(eq(feedbackTickets.locationId, locationId))
    .orderBy(desc(feedbackTickets.createdAt));
}

/**
 * The stored object behind one attachment, with its ticket's tenant.
 *
 * Returns the `locationId` so the calling route can decide access rather than
 * this function deciding it — the platform route allows any, the school route
 * compares it with the verified session. Putting the comparison here would mean
 * one of the two callers passing a tenant it is not allowed to have.
 */
export async function getFeedbackAttachment(attachmentId: string): Promise<{
  storagePath: string;
  fileName: string;
  contentType: string;
  locationId: string;
} | null> {
  const [row] = await db
    .select({
      storagePath: feedbackAttachments.storagePath,
      fileName: feedbackAttachments.fileName,
      contentType: feedbackAttachments.contentType,
      locationId: feedbackTickets.locationId,
    })
    .from(feedbackAttachments)
    .innerJoin(feedbackTickets, eq(feedbackTickets.id, feedbackAttachments.ticketId))
    .where(eq(feedbackAttachments.id, attachmentId))
    .limit(1);

  return row ?? null;
}
