import 'server-only';

import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';

import {
  branches,
  schoolModules,
  schoolUsers,
  studentEnrollments,
  studentGuardians,
  studentProfiles,
  type SchoolUser,
} from '@/db/schema';
import {
  PLATFORM_MODULE_KEYS,
  toModuleFlags,
  type SchoolModuleFlags,
} from '@/lib/platform-modules';
import type { UserRole } from '@/types/school-auth';

import { getActiveAcademicYear } from './admissions-queries';
import { ownedBy } from './branch-scope';
import { db } from './drizzle';
import { deleteAuthUser, findAuthUserByEmail, normaliseEmail } from './supabase-auth';

/**
 * Tenant-scoped reads shared by the portal layouts, pages and API routes.
 *
 * Every function here takes `locationId` as its first argument and filters on
 * it. That value must always originate from verified session claims — passing
 * one from a request body would defeat the isolation these queries provide.
 */

export interface SchoolUserRow {
  id: string;
  authUserId: string | null;
  name: string;
  email: string | null;
  phone: string;
  role: string;
  branchId: string | null;
  branchName: string | null;
  isActive: boolean;
  joinedAt: Date | null;
  createdAt: Date;
}

/**
 * One row of the Users & Staff directory.
 *
 * `contactPhone` is what the screen prints; `phone` is what the column holds.
 * They differ for exactly one role and the difference is item 1 of Sprint 20 —
 * see `listSchoolUsers`.
 */
export interface SchoolUserListRow extends SchoolUserRow {
  /**
   * The number a person would actually ring, or null when there is nobody.
   *
   * For staff it is `school_users.phone`. For a **student** it is their primary
   * guardian's, because `school_users.phone` is `NOT NULL`, a seven-year-old
   * has no phone, and `studentDirectoryPhone` therefore fills it with the
   * sentinel `student:LGS-2026-0009`. Null where a student has no guardian on
   * file; the screen prints `—`, never the sentinel.
   */
  contactPhone: string | null;
}

const USER_COLUMNS = {
  id: schoolUsers.id,
  authUserId: schoolUsers.authUserId,
  name: schoolUsers.name,
  email: schoolUsers.email,
  phone: schoolUsers.phone,
  role: schoolUsers.role,
  branchId: schoolUsers.branchId,
  branchName: branches.name,
  isActive: schoolUsers.isActive,
  joinedAt: schoolUsers.joinedAt,
  createdAt: schoolUsers.createdAt,
} as const;

/**
 * The three states the directory actually shows, and the one filter that used
 * to disagree with them.
 *
 * The table has always rendered three badges, but the filter only offered two
 * — Active and Inactive, both read from `is_active`. A member who has never
 * signed in has `is_active = true`, so "Active only" returned every Pending row
 * as well and the filter looked broken because it was.
 *
 * `pending` is read from `auth_user_id`, not `joined_at`: having a Supabase
 * identity is what "has signed in at least once" means, and it is the same
 * source the Super Admin table has used since STATE.md §5g.
 */
export const USER_STATUSES = ['active', 'pending', 'inactive'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export function isUserStatus(value: unknown): value is UserStatus {
  return typeof value === 'string' && (USER_STATUSES as readonly string[]).includes(value);
}

/**
 * Sentinel for members who belong to no branch — school-wide roles such as
 * `school_admin`, whose `branch_id` is NULL.
 *
 * `''` already means "do not filter on branch", so without a third value there
 * was no way to ask for these people at all: they were visible only when the
 * branch filter was off entirely.
 */
export const UNASSIGNED_BRANCH = 'unassigned';

/** The columns the directory may be ordered by. */
export const SCHOOL_USER_SORT_COLUMNS = [
  'name',
  'role',
  'branch',
  'phone',
  'joinedAt',
] as const;

export type SchoolUserSortColumn = (typeof SCHOOL_USER_SORT_COLUMNS)[number];

export interface ListUsersFilters {
  role?: string | undefined;
  /** The dropdown's choice. A *filter*, which the reader may clear. */
  branchId?: string | undefined;
  /**
   * The campuses this reader may see at all, from `resolveBranchScope`.
   *
   * Distinct from `branchId` above, and the distinction matters: this is a
   * **boundary**, not a filter. It is applied to the page query, the total and
   * all three facet counts — including the branch facet, which omits its own
   * *filter* so the dropdown can be changed but must not omit the boundary, or
   * the counts would offer campuses the reader cannot open.
   *
   * `null` = every campus, which is what every caller before Sprint 19a got.
   */
  branchIds?: string[] | null | undefined;
  status?: UserStatus | undefined;
  search?: string | undefined;
  page?: number | undefined;
  limit?: number | undefined;
  sort?: SchoolUserSortColumn | undefined;
  direction?: 'asc' | 'desc' | undefined;
}

/** One selectable value on a filter, with how many rows it would return. */
export interface FacetCount {
  value: string;
  label: string;
  count: number;
}

/**
 * What each filter may offer, given the others.
 *
 * Every facet is counted with its **own** dimension's condition omitted and all
 * the others applied. That asymmetry is the whole point: counting a dimension
 * against its own selection would collapse each dropdown to the single value
 * already chosen, and there would be no way to change your mind without
 * clearing the filter first.
 */
export interface UserFacets {
  roles: FacetCount[];
  branches: FacetCount[];
  statuses: FacetCount[];
}

/** SQL for one of the three displayed states. */
function statusCondition(status: UserStatus): SQL {
  if (status === 'inactive') return eq(schoolUsers.isActive, false);

  return status === 'pending'
    ? and(eq(schoolUsers.isActive, true), isNull(schoolUsers.authUserId))!
    : and(eq(schoolUsers.isActive, true), isNotNull(schoolUsers.authUserId))!;
}

/** The status of a row as a value, for grouping. Mirrors `statusCondition`. */
const STATUS_EXPRESSION = sql<string>`case
  when ${schoolUsers.isActive} = false then 'inactive'
  when ${schoolUsers.authUserId} is null then 'pending'
  else 'active'
end`;

/**
 * Builds the WHERE conditions for a filter set, optionally leaving one
 * dimension out so that dimension's own facet can be counted.
 */
function userConditions(
  locationId: string,
  filters: ListUsersFilters,
  omit?: 'role' | 'branch' | 'status',
): SQL[] {
  const conditions: SQL[] = [eq(schoolUsers.locationId, locationId)];

  /*
   * The branch boundary, applied to every condition set including the ones a
   * facet omits its own dimension from.
   *
   * `ownedBy` rather than `sharedOrOwnedBy`: a member with a null `branch_id`
   * is a *school-wide* role — the owner, an accountant — and a campus
   * administrator has never been shown them. That is what "My Branch Staff"
   * means on the heading above this table, and widening it here would put the
   * school's owner into a campus's staff list.
   *
   * §5bf: the count carries the same filters as the page, or a total that
   * counts rows the page cannot show pages the reader off the end of the list.
   */
  const boundary = ownedBy(schoolUsers.branchId, filters.branchIds ?? null);
  if (boundary !== undefined) conditions.push(boundary);

  if (omit !== 'role' && filters.role !== undefined && filters.role !== '') {
    conditions.push(eq(schoolUsers.role, filters.role));
  }

  if (omit !== 'branch' && filters.branchId !== undefined && filters.branchId !== '') {
    conditions.push(
      filters.branchId === UNASSIGNED_BRANCH
        ? isNull(schoolUsers.branchId)
        : eq(schoolUsers.branchId, filters.branchId),
    );
  }

  if (omit !== 'status' && filters.status !== undefined) {
    conditions.push(statusCondition(filters.status));
  }

  // Search is not a facet dimension — it narrows every dropdown and is never
  // omitted, because a name is not something the filter bar offers to pick.
  if (filters.search !== undefined && filters.search.trim() !== '') {
    const pattern = `%${filters.search.trim()}%`;
    const matches = or(
      ilike(schoolUsers.name, pattern),
      ilike(schoolUsers.phone, pattern),
      ilike(schoolUsers.email, pattern),
    );
    if (matches !== undefined) conditions.push(matches);
  }

  return conditions;
}

/**
 * The school's own directory, with facet counts.
 *
 * ── Sprint 20, item 1: a student's row shows their guardian's number ─────
 * The Phone column printed `student:LGS-2026-0009` on four rows of the live
 * tenant. That is `studentDirectoryPhone`'s sentinel: `school_users.phone` is
 * `NOT NULL`, a seven-year-old has no phone, and the enrolment writes the
 * admission number there so the column has something in it.
 * `formatPhoneForDisplay` already refuses to mask a value containing a letter,
 * so the sentinel was passing through untouched — the defect was the
 * *selection*, not the formatting, which is why it is fixed here.
 *
 * §5bf fixed the same thing on the all-students list. This is that fix, one
 * screen over, resolving the guardian through the student's profile rather than
 * through the enrolment.
 */
export async function listSchoolUsers(
  locationId: string,
  filters: ListUsersFilters,
): Promise<{
  users: SchoolUserListRow[];
  total: number;
  page: number;
  limit: number;
  facets: UserFacets;
}> {
  const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);
  const page = Math.max(filters.page ?? 1, 1);

  /*
   * The primary guardian's number, one row per student directory account.
   *
   * Grouped on `student_profiles.school_user_id` rather than on the profile id,
   * because the outer query is over `school_users` and that is the key it joins
   * on. A joined subquery rather than a correlated sub-select: the directory is
   * paginated and sorted in the database, and anything per-row would run once
   * per member on a screen somebody is waiting on.
   *
   * `array_agg(… order by …)` is the ordered-aggregate form of "first by this
   * ranking" — the guardian flagged primary, then the earliest recorded. There
   * is no operator for an ordered aggregate, which is the only reason this is a
   * raw template; no JavaScript value is interpolated into it.
   *
   * ── Aliased `student_guardian_phone`, and that is load-bearing ────────
   * Drizzle emits a raw-`sql` subquery column by its alias **unqualified**.
   * This statement also joins `school_users`, which has a `phone` of its own,
   * so an alias of `phone` would make the whole listing fail to parse with
   * `column reference "phone" is ambiguous` (42702) — which is exactly the 500
   * §5bg records shipping on the all-students screen. A name no other joined
   * table carries resolves unambiguously without qualifying anything, and the
   * reference below is written out qualified anyway.
   */
  const studentContact = db
    .select({
      // A plain column, so Drizzle qualifies the outer reference for us. The
      // derived column keeps its own name, `school_user_id`, which nothing else
      // in this statement has.
      schoolUserId: studentProfiles.schoolUserId,
      phone:
        sql<string>`(array_agg(${studentGuardians.phone} order by ${studentGuardians.isPrimaryContact} desc, ${studentGuardians.createdAt} asc))[1]`.as(
          'student_guardian_phone',
        ),
    })
    .from(studentGuardians)
    .innerJoin(
      studentProfiles,
      eq(studentProfiles.id, studentGuardians.studentProfileId),
    )
    .where(eq(studentGuardians.locationId, locationId))
    .groupBy(studentProfiles.schoolUserId)
    .as('student_contact');

  /*
   * Written out qualified for the reason above. A qualified reference to a
   * joined relation is valid wherever it appears; a bare select-list alias is
   * not, and would bind to `school_users.phone` in a `WHERE` — the sentinel
   * this column exists to stop showing people.
   *
   * Not added to the free-text search: the search is over the whole directory
   * and its total is counted by a second statement that does not carry this
   * join. Widening one without the other is how a reader pages off the end of
   * a list, which is §5bf's own note.
   */
  const guardianPhoneColumn = sql<
    string | null
  >`"student_contact"."student_guardian_phone"`;

  const order = filters.direction === 'desc' ? desc : asc;
  const sortColumn = {
    name: schoolUsers.name,
    role: schoolUsers.role,
    branch: branches.name,
    phone: schoolUsers.phone,
    joinedAt: schoolUsers.joinedAt,
  }[filters.sort ?? 'name'];

  const where = and(...userConditions(locationId, filters));

  const [rows, totals, roleFacets, branchFacets, statusFacets] = await Promise.all([
    db
      .select({ ...USER_COLUMNS, guardianPhone: guardianPhoneColumn })
      .from(schoolUsers)
      .leftJoin(branches, eq(branches.id, schoolUsers.branchId))
      // A LEFT join, and only on the page query. It cannot multiply rows — the
      // subquery is grouped on the key it is joined by — and it is deliberately
      // absent from the count and the three facet queries, which read no phone
      // and must keep the numbers they had before this sprint.
      .leftJoin(studentContact, eq(studentContact.schoolUserId, schoolUsers.id))
      .where(where)
      .orderBy(order(sortColumn))
      .limit(limit)
      .offset((page - 1) * limit),
    db.select({ value: count() }).from(schoolUsers).where(where),

    db
      .select({ value: schoolUsers.role, total: count() })
      .from(schoolUsers)
      .where(and(...userConditions(locationId, filters, 'role')))
      .groupBy(schoolUsers.role),

    db
      .select({
        value: schoolUsers.branchId,
        label: branches.name,
        total: count(),
      })
      .from(schoolUsers)
      .leftJoin(branches, eq(branches.id, schoolUsers.branchId))
      .where(and(...userConditions(locationId, filters, 'branch')))
      .groupBy(schoolUsers.branchId, branches.name)
      .orderBy(asc(branches.name)),

    db
      .select({ value: STATUS_EXPRESSION, total: count() })
      .from(schoolUsers)
      .where(and(...userConditions(locationId, filters, 'status')))
      .groupBy(STATUS_EXPRESSION),
  ]);

  return {
    /*
     * The number to print, decided here rather than on the screen.
     *
     * A student's own directory row is a sentinel by construction, so it is
     * *never* offered as a contact: where the guardian resolves to nothing the
     * answer is null, which the table renders as `—`. Printing the sentinel is
     * not acceptable in any case, and neither is printing a number that is
     * really an admission number with the colon taken out.
     */
    users: rows.map(({ guardianPhone, ...user }) => ({
      ...user,
      contactPhone:
        user.role === 'student' ? (guardianPhone ?? null) : (user.phone || null),
    })),
    total: totals[0]?.value ?? 0,
    page,
    limit,
    facets: {
      // Labels for roles and statuses are the caller's business — both are
      // fixed vocabularies with UI copy of their own. Branch names are not,
      // so they travel with the count.
      roles: roleFacets.map((row) => ({
        value: row.value,
        label: row.value,
        count: row.total,
      })),
      branches: branchFacets.map((row) => ({
        value: row.value ?? UNASSIGNED_BRANCH,
        label: row.label ?? 'All branches',
        count: row.total,
      })),
      statuses: statusFacets
        .filter((row) => isUserStatus(row.value))
        .map((row) => ({ value: row.value, label: row.value, count: row.total })),
    },
  };
}

/**
 * Members matching a set of ids, for the bulk actions.
 *
 * Tenant-filtered, so an id belonging to another school simply does not come
 * back and the caller reports it as not found rather than acting on it.
 */
export async function listSchoolUsersByIds(
  locationId: string,
  userIds: readonly string[],
): Promise<SchoolUserRow[]> {
  if (userIds.length === 0) return [];

  return db
    .select(USER_COLUMNS)
    .from(schoolUsers)
    .leftJoin(branches, eq(branches.id, schoolUsers.branchId))
    .where(
      and(eq(schoolUsers.locationId, locationId), inArray(schoolUsers.id, [...userIds])),
    )
    .orderBy(asc(schoolUsers.name));
}

/**
 * How many active `school_admin` members a school has.
 *
 * Guards the delete paths: a school with nobody left who can administer it
 * cannot invite anyone, and recovering it takes a platform operator.
 */
export async function countActiveSchoolAdmins(locationId: string): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(schoolUsers)
    .where(
      and(
        eq(schoolUsers.locationId, locationId),
        eq(schoolUsers.role, 'school_admin'),
        eq(schoolUsers.isActive, true),
      ),
    );

  return rows[0]?.value ?? 0;
}

export async function getSchoolUserById(
  locationId: string,
  userId: string,
): Promise<SchoolUserRow | null> {
  const rows = await db
    .select(USER_COLUMNS)
    .from(schoolUsers)
    .leftJoin(branches, eq(branches.id, schoolUsers.branchId))
    .where(and(eq(schoolUsers.locationId, locationId), eq(schoolUsers.id, userId)))
    .limit(1);

  return rows[0] ?? null;
}

/** The index `0038` adds. Named here so every reader spells it once. */
export const EMAIL_INDEX = 'school_users_location_email_active_idx';

/**
 * Whether a write failed on `0038`'s address index rather than on the phone one.
 *
 * `school_users` now has two unique indexes a write can land on, and they mean
 * different things to whoever is at the keyboard: one says the number is taken,
 * the other says the address is. Before this existed, three routes reported the
 * second as the first — `POST /api/school/users` told an administrator that a
 * phone number was in use when the number was free and the address was not, and
 * they had nothing to correct.
 *
 * The SQLSTATE is on the error's `cause` and not on the error: postgres-js
 * raises it, Drizzle wraps it, and reading `.code` at the top level answers
 * `undefined` for every failure. That is the same trap `check-sprint20` records,
 * and it is why the chain is walked rather than the surface read.
 */
export function isEmailIndexConflict(error: unknown): boolean {
  let current: unknown = error;

  for (let depth = 0; depth < 5 && current !== null && current !== undefined; depth += 1) {
    const candidate = current as { code?: unknown; constraint_name?: unknown; message?: unknown };
    if (candidate.code === '23505') {
      const named = `${String(candidate.constraint_name ?? '')} ${String(candidate.message ?? '')}`;
      return named.includes(EMAIL_INDEX);
    }
    current = (current as { cause?: unknown }).cause;
  }

  return false;
}

/**
 * Who already holds this address at this school, if anybody but `exceptId`.
 *
 * The pre-check the write routes use so the school meets a sentence instead of
 * a SQLSTATE. It is deliberately *not* the only guard — `isEmailIndexConflict`
 * above catches the same collision from the database — because a check and a
 * write are two statements and a second administrator can arrive between them.
 * The read gives a good message; the catch guarantees there is one.
 */
export async function emailHolderAt(
  locationId: string,
  email: string | null | undefined,
  exceptId?: string,
): Promise<{ id: string; name: string; role: string } | null> {
  const address = (email ?? '').trim();
  if (address === '') return null;

  const rows = await db
    .select({ id: schoolUsers.id, name: schoolUsers.name, role: schoolUsers.role })
    .from(schoolUsers)
    .where(
      and(
        eq(schoolUsers.locationId, locationId),
        eq(schoolUsers.isActive, true),
        sql`lower(${schoolUsers.email}) = lower(${address})`,
      ),
    )
    .orderBy(asc(schoolUsers.createdAt), asc(schoolUsers.id));

  return rows.find((row) => row.id !== exceptId) ?? null;
}

/**
 * Every active membership of one school carrying one email address.
 *
 * Normally exactly one, and after migration `0038`'s partial unique index on
 * `(location_id, lower(email))` it can be nothing else. It returns a *list*
 * because the interesting answer is "more than one", and because a function
 * that returned a single row would have had to choose — which is the whole
 * defect Sprint 21 was opened for. `otp/verify` binds only when there is one
 * and signs the session out otherwise.
 *
 * Matched on `lower(email)` rather than on `=`, because that is what the index
 * constrains. A row stored as `Father@Example.com` occupies the slot either
 * way; matching it exactly would leave it holding an address it cannot sign in
 * with.
 */
export async function activeMembershipsByEmail(
  locationId: string,
  email: string,
): Promise<{ id: string; role: string; name: string }[]> {
  return db
    .select({ id: schoolUsers.id, role: schoolUsers.role, name: schoolUsers.name })
    .from(schoolUsers)
    .where(
      and(
        eq(schoolUsers.locationId, locationId),
        eq(schoolUsers.isActive, true),
        sql`lower(${schoolUsers.email}) = lower(${email})`,
      ),
    )
    .orderBy(asc(schoolUsers.createdAt), asc(schoolUsers.id));
}

/**
 * The membership one Supabase account holds at one school.
 *
 * `school_users_location_id_auth_user_id_idx` makes this at most one row, so
 * the `limit(1)` is the index's promise written down rather than a choice. It
 * is ordered anyway, and that is not belt-and-braces: an unordered `LIMIT 1` is
 * only ever ambiguous when something has already gone wrong, and Sprint 21
 * found out what that costs. A father's uid ended up on his daughter's
 * directory row, and the whole reason it was hard to see was that every read in
 * the sign-in path answered *confidently* — with a row, promptly, and with no
 * indication that another had been just as eligible.
 *
 * Oldest first, so that if the index is ever dropped or the constraint
 * deferred, two consecutive requests at least get the same answer and the
 * defect is a reproducible one rather than an intermittent one.
 */
export async function getSchoolUserByUid(
  locationId: string,
  authUserId: string,
): Promise<SchoolUserRow | null> {
  const rows = await db
    .select(USER_COLUMNS)
    .from(schoolUsers)
    .leftJoin(branches, eq(branches.id, schoolUsers.branchId))
    .where(
      and(eq(schoolUsers.locationId, locationId), eq(schoolUsers.authUserId, authUserId)),
    )
    .orderBy(asc(schoolUsers.createdAt), asc(schoolUsers.id))
    .limit(1);

  return rows[0] ?? null;
}

/** Postgres foreign_key_violation. */
const FOREIGN_KEY_VIOLATION = '23503';

function isForeignKeyViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === FOREIGN_KEY_VIOLATION
  );
}

/**
 * Deletes one member, translating the referential refusal into words.
 *
 * Tenant-filtered in the statement itself, so a member id from another school
 * deletes nothing and is reported as not found. Callers are responsible for the
 * *policy* refusals — self-delete, the last administrator, a branch admin
 * reaching outside their branch — because those differ by surface; this
 * function owns only what the database has to say.
 */
export type DeleteRefusal = 'not_found' | 'referenced';

export async function deleteSchoolMember(
  locationId: string,
  userId: string,
): Promise<{ deleted: true } | { deleted: false; refusal: DeleteRefusal }> {
  try {
    const removed = await db
      .delete(schoolUsers)
      .where(and(eq(schoolUsers.locationId, locationId), eq(schoolUsers.id, userId)))
      .returning({
        id: schoolUsers.id,
        email: schoolUsers.email,
        authUserId: schoolUsers.authUserId,
      });

    const deleted = removed[0];
    if (deleted === undefined) return { deleted: false, refusal: 'not_found' };

    await releaseAuthAccount(deleted.email, deleted.authUserId);

    return { deleted: true };
  } catch (error) {
    if (isForeignKeyViolation(error)) return { deleted: false, refusal: 'referenced' };
    throw error;
  }
}

/**
 * Deletes the Supabase account behind a member who has just been removed.
 *
 * ── Why the membership alone was not enough ──────────────────────────────
 * Deleting the `school_users` row ended the person's access and looked, from
 * every screen in this application, like a complete removal. It was not.
 * `auth.users.email` is globally unique, so the account left behind kept the
 * address claimed forever, and re-inviting the same person put them back onto
 * that old account: `getOrCreateAuthUser` finds it, hands it back, and the "new"
 * member silently inherits the previous one's password and metadata. Somebody
 * deleted for cause could still sign in the moment they were re-added.
 *
 * ── The check that has to happen first ───────────────────────────────────
 * One Supabase account is one *human*, not one membership — that is the whole
 * design in `lib/supabase-auth.ts`, and it is what lets the same address be a
 * teacher at one school and a parent at another. So the account may only be
 * deleted once the last of those memberships is gone. Deleting it while another
 * school still lists them would lock that person out of a school that never
 * asked for anything, and would do so invisibly, because nothing in the other
 * school's data would have changed.
 *
 * The check is by address rather than by `auth_user_id`, because a member who
 * has never signed in has no `auth_user_id` and yet may well hold an account —
 * `lib/school-bootstrap.ts` registers the address the moment an administrator
 * is provisioned. Matching on the id would leave exactly those accounts behind,
 * which is the commonest case for someone deleted shortly after being added.
 *
 * Never throws. The membership is already gone; a tidy-up that fails is worth a
 * log line, not a 500 telling the operator their delete failed when it did not.
 */
async function releaseAuthAccount(
  email: string | null,
  authUserId: string | null,
): Promise<void> {
  const address = normaliseEmail(email ?? '');
  if (address === '' && authUserId === null) return;

  try {
    if (address !== '') {
      const stillAMember = await db
        .select({ id: schoolUsers.id })
        .from(schoolUsers)
        .where(eq(sql`lower(${schoolUsers.email})`, address))
        .limit(1);

      if (stillAMember.length > 0) return;
    }

    // `auth_user_id` when the person has signed in, otherwise resolve the
    // address — a member registered but never set up has the second and not
    // the first.
    const account =
      authUserId !== null ? { id: authUserId } : await findAuthUserByEmail(address);

    if (account !== null) await deleteAuthUser(account.id);
  } catch (error) {
    console.warn(
      '[school-queries] the membership was deleted but its Supabase account ' +
        `was not: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }
}

/**
 * Deletes the Supabase accounts of a school that is about to be erased.
 *
 * ── Why this cannot be left to the cascade ───────────────────────────────
 * Deleting a `schools` row cascades through all 61 foreign keys and takes every
 * `school_users` row with it, without a line of application code running. The
 * Supabase accounts those rows pointed at are in a different system entirely
 * and survive untouched — so a deleted school would leave its whole staff list
 * holding credentials to a tenant that no longer exists, and every one of those
 * addresses permanently claimed against re-use.
 *
 * ── Run it *before* the delete ───────────────────────────────────────────
 * Afterwards there is no row left to say which addresses belonged to this
 * tenant. That ordering is the whole reason this is a separate function rather
 * than something the delete route does inline afterwards.
 *
 * ── The same one-account-per-human rule ──────────────────────────────────
 * An address is only released when no membership of any *other* school holds
 * it. A parent with children at two schools, or a teacher who moved, must not
 * be locked out of the school that still employs them because a different one
 * was deleted. This is the same guard `releaseAuthAccount` applies to a single
 * member, applied in bulk.
 *
 * Returns how many accounts were removed, for the operator's log line. Never
 * throws: the school is being deleted either way, and a tidy-up that fails is
 * worth a warning rather than a failed request that leaves the tenant half-gone.
 */
export async function releaseSchoolAuthAccounts(locationId: string): Promise<number> {
  try {
    const members = await db
      .select({ email: schoolUsers.email, authUserId: schoolUsers.authUserId })
      .from(schoolUsers)
      .where(eq(schoolUsers.locationId, locationId));

    let released = 0;

    for (const member of members) {
      const address = normaliseEmail(member.email ?? '');
      if (address === '' && member.authUserId === null) continue;

      if (address !== '') {
        // Any membership of another school keeps the account alive.
        const elsewhere = await db
          .select({ id: schoolUsers.id })
          .from(schoolUsers)
          .where(
            and(
              eq(sql`lower(${schoolUsers.email})`, address),
              ne(schoolUsers.locationId, locationId),
            ),
          )
          .limit(1);

        if (elsewhere.length > 0) continue;
      }

      const account =
        member.authUserId !== null
          ? { id: member.authUserId }
          : await findAuthUserByEmail(address);

      if (account !== null && (await deleteAuthUser(account.id))) released += 1;
    }

    return released;
  } catch (error) {
    console.warn(
      '[school-queries] the school is being deleted but its Supabase accounts ' +
        `could not all be released: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
    return 0;
  }
}

/** Enabled-module flags for one school. */
export async function getModuleFlags(locationId: string): Promise<SchoolModuleFlags> {
  const rows = await db
    .select({ moduleKey: schoolModules.moduleKey, isEnabled: schoolModules.isEnabled })
    .from(schoolModules)
    .where(eq(schoolModules.locationId, locationId));

  return toModuleFlags(rows);
}

export interface BranchOption {
  id: string;
  name: string;
  code: string;
  city: string;
}

export async function listBranchOptions(locationId: string): Promise<BranchOption[]> {
  return db
    .select({
      id: branches.id,
      name: branches.name,
      code: branches.code,
      city: branches.city,
    })
    .from(branches)
    .where(and(eq(branches.locationId, locationId), eq(branches.isActive, true)))
    .orderBy(asc(branches.name));
}

export interface DashboardCounts {
  students: number;
  staff: number;
  branches: number;
  modules: number;
  /** Null when no academic year is active, so the UI can say why. */
  activeYearName: string | null;
}

const STAFF_ROLES: readonly UserRole[] = [
  'teacher',
  'accountant',
  'hr_manager',
  'branch_admin',
];

/**
 * Headline counts for the admin dashboard, all scoped to one school.
 *
 * Students are counted from `student_enrollments` in the active academic year
 * rather than from the directory: a graduated or withdrawn student keeps their
 * `school_users` row, so counting those would only ever go up.
 */
export async function getDashboardCounts(locationId: string): Promise<DashboardCounts> {
  const activeYear = await getActiveAcademicYear(locationId);

  const [studentRows, staffRows, branchRows, moduleRows] = await Promise.all([
    activeYear === null
      ? Promise.resolve([{ value: 0 }])
      : db
          .select({ value: count() })
          .from(studentEnrollments)
          .where(
            and(
              eq(studentEnrollments.locationId, locationId),
              eq(studentEnrollments.academicYearId, activeYear.id),
              eq(studentEnrollments.status, 'active'),
            ),
          ),
    db
      .select({ role: schoolUsers.role })
      .from(schoolUsers)
      .where(
        and(eq(schoolUsers.locationId, locationId), eq(schoolUsers.isActive, true)),
      ),
    db
      .select({ value: count() })
      .from(branches)
      .where(and(eq(branches.locationId, locationId), eq(branches.isActive, true))),
    db
      .select({ value: count() })
      .from(schoolModules)
      .where(
        and(
          eq(schoolModules.locationId, locationId),
          eq(schoolModules.isEnabled, true),
          // This table once also held delivery-channel flags, which are not
          // modules and would have inflated every school's headline "modules
          // enabled" figure. `0028` removed the last of them; the filter stays,
          // because the table is still keyed by an open text column.
          inArray(schoolModules.moduleKey, [...PLATFORM_MODULE_KEYS]),
        ),
      ),
  ]);

  // Counted in memory rather than with an IN clause so the staff role list
  // stays a single definition shared with the rest of the app.
  const staff = staffRows.filter((row) =>
    (STAFF_ROLES as readonly string[]).includes(row.role),
  ).length;

  return {
    students: studentRows[0]?.value ?? 0,
    staff,
    branches: branchRows[0]?.value ?? 0,
    modules: moduleRows[0]?.value ?? 0,
    activeYearName: activeYear?.name ?? null,
  };
}

export type { SchoolUser };
