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

export async function listSchoolUsers(
  locationId: string,
  filters: ListUsersFilters,
): Promise<{
  users: SchoolUserRow[];
  total: number;
  page: number;
  limit: number;
  facets: UserFacets;
}> {
  const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);
  const page = Math.max(filters.page ?? 1, 1);

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
      .select(USER_COLUMNS)
      .from(schoolUsers)
      .leftJoin(branches, eq(branches.id, schoolUsers.branchId))
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
    users: rows,
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
