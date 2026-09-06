import 'server-only';

import { and, asc, eq, inArray } from 'drizzle-orm';

import {
  DESK_FALLBACK_ROLE,
  ROLE_INBOXES,
  type RoleInboxKey,
} from '@/db/schema/chat-conversations';
import { schoolUsers } from '@/db/schema/school-users';
import type { UserRole } from '@/types/school-auth';

import { db } from './drizzle';

/**
 * Who is on each desk, at one school.
 *
 * ── The defect this file exists to fix ───────────────────────────────────
 * A desk thread used to be created with **no staff seat at all**. The parent
 * was its only participant, `listInbox` reads through participant rows, and
 * nothing anywhere else listed an unclaimed thread — so a message to the
 * Accounts Office appeared in no member of staff's inbox, moved no badge, rang
 * no bell, and waited for somebody to call `POST …/claim` with an id they had
 * no screen to discover. Four desks on the parent's dropdown reached nobody.
 *
 * So the answerers are seated when the thread is opened, exactly as a direct
 * thread's recipient is, and every mechanism that already works for a direct
 * thread — the inbox, the unread dot, the sidebar badge, the bell entry, the
 * chime, the digest — works for a desk with no new plumbing. `claimed_by`
 * keeps its meaning on top of that: it says which of them picked it up.
 *
 * ── Branch scoping ───────────────────────────────────────────────────────
 * A campus administrator answers their own campus. Staff with no branch on
 * their record are school-wide and answer everywhere, which is what a
 * `branch_id` of null has meant since Sprint 19a — see `lib/branch-scope.ts`.
 * A thread with no branch (a parent whose children span campuses) is answered
 * by everyone who holds the role.
 */

/** One member of staff who can answer a desk. */
export interface DeskAnswerer {
  schoolUserId: string;
  name: string;
  role: UserRole;
  branchId: string | null;
  /** True when they are here only because nobody holds the desk's own roles. */
  isFallback: boolean;
}

/** Every role that answers any desk, plus the fallback. One query, not five. */
const ALL_DESK_ROLES: readonly string[] = [
  ...new Set([
    ...ROLE_INBOXES.flatMap((inbox) => inbox.answeredBy as readonly string[]),
    DESK_FALLBACK_ROLE,
  ]),
];

interface StaffRow {
  schoolUserId: string;
  name: string;
  role: string;
  branchId: string | null;
}

/**
 * Every active member of staff who sits on any desk at this school.
 *
 * Read once and filtered in memory. A school has tens of these rows, not
 * thousands, and one round trip that answers all four desks is cheaper than
 * four that each answer one — this runs on the parent's compose screen, which
 * is a screen a parent opens on a phone on a slow connection.
 */
async function deskStaff(locationId: string): Promise<StaffRow[]> {
  return db
    .select({
      schoolUserId: schoolUsers.id,
      name: schoolUsers.name,
      role: schoolUsers.role,
      branchId: schoolUsers.branchId,
    })
    .from(schoolUsers)
    .where(
      and(
        eq(schoolUsers.locationId, locationId),
        eq(schoolUsers.isActive, true),
        inArray(schoolUsers.role, [...ALL_DESK_ROLES]),
      ),
    )
    .orderBy(asc(schoolUsers.name));
}

/** Whether this person answers at this campus. Null on either side is "all". */
function servesBranch(staffBranchId: string | null, threadBranchId: string | null): boolean {
  return staffBranchId === null || threadBranchId === null || staffBranchId === threadBranchId;
}

function pick(
  rows: readonly StaffRow[],
  inboxKey: RoleInboxKey,
  branchId: string | null,
): DeskAnswerer[] {
  const inbox = ROLE_INBOXES.find((entry) => entry.key === inboxKey);
  if (inbox === undefined) return [];

  const owners = rows.filter(
    (row) =>
      (inbox.answeredBy as readonly string[]).includes(row.role) &&
      servesBranch(row.branchId, branchId),
  );

  const chosen =
    owners.length > 0
      ? owners
      : rows.filter(
          (row) => row.role === DESK_FALLBACK_ROLE && servesBranch(row.branchId, branchId),
        );

  return chosen.map((row) => ({
    schoolUserId: row.schoolUserId,
    name: row.name,
    role: row.role as UserRole,
    branchId: row.branchId,
    isFallback: owners.length === 0,
  }));
}

/**
 * The staff seated on one desk thread.
 *
 * Called when a thread is opened, so the answer is fixed at that moment rather
 * than recomputed on every read. A member of staff who joins the school
 * tomorrow does not appear in yesterday's thread — which is the same property
 * `chat_participants` gives every other kind of conversation, and the reason a
 * withdrawn parent stops receiving one.
 */
export async function deskAnswerers(
  locationId: string,
  inboxKey: RoleInboxKey,
  branchId: string | null,
): Promise<DeskAnswerer[]> {
  return pick(await deskStaff(locationId), inboxKey, branchId);
}

/**
 * The desks that have somebody to answer them, for the compose dropdown.
 *
 * The product owner's rule, in one sentence: *if the claiming staff is not
 * created, appointed, or has been removed from the system, do not give the
 * option of starting a message with that role.* A desk survives that test on
 * its own roles or on the school admin fallback; a desk that fails it is left
 * off the list rather than accepting an enquiry into an empty room.
 */
export async function desksWithAnswerers(
  locationId: string,
  branchId: string | null,
): Promise<RoleInboxKey[]> {
  const rows = await deskStaff(locationId);

  return ROLE_INBOXES.filter((inbox) => pick(rows, inbox.key, branchId).length > 0).map(
    (inbox) => inbox.key,
  );
}
