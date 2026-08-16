import 'server-only';

import { and, asc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { cache } from 'react';

import {
  branches,
  principalAssignments,
  schoolUsers,
  schools,
  type PrincipalModel,
} from '@/db/schema';

import { db } from './drizzle';

/**
 * `lib/principal-resolver.ts` — BR4. Which part of the school is this head's?
 *
 * ── The one question this module answers ──────────────────────────────────
 * Everything about multiple principals reduces to: given a signed-in person,
 * which branches and which grades are theirs? `resolvePrincipalScope()` returns
 * that, and every screen that narrows for a head reads it. There is deliberately
 * no second way to work it out.
 *
 * ── It narrows sight, never permission ────────────────────────────────────
 * A principal's *permissions* are unchanged — the same list Sprint 8 gives the
 * `principal` role, resolved through the same matrix. What an assignment
 * changes is the set of rows they are shown. Keeping these separate is what
 * lets BR4 exist without touching `PERMISSIONS`, `DEFAULT_ROLE_PERMISSIONS` or
 * a single `allowedRoles` list.
 *
 * That separation has a consequence worth stating plainly rather than
 * discovering: **this is a visibility boundary, not an authorization one.** It
 * is applied by the queries that read it. A route that forgets to read it shows
 * a head the whole school, which is what they saw before Sprint 13 and is not a
 * leak across tenants — `location_id` still comes from the verified session and
 * nothing here relaxes that. Treat a missed narrowing as a defect, not a breach.
 *
 * ── Unscoped is a real answer, and the common one ─────────────────────────
 * A school on `principal_model = 'single'` gets `{ scoped: false }`, and so does
 * every role that is not `principal`. `scoped: false` means "show everything
 * this person's permissions allow" — exactly the behaviour of every screen
 * before this file existed. That is what makes this safe to call from anywhere:
 * adding the call to a screen changes nothing until a school opts in.
 */

/**
 * What a principal may see.
 *
 * `branchIds: null` means every campus; `gradeIds: null` means every grade.
 * Null rather than "the list of all of them" on purpose — a list would be a
 * snapshot that goes stale the moment a campus opens, and this is read on every
 * request. Null is the only value that stays correct.
 *
 * An empty array is different from null and is a legal answer: a head assigned
 * to a division that has been given no grades reaches no grades. The screens
 * say so rather than quietly showing nothing, which would read as a broken page.
 */
export interface PrincipalScope {
  /** False for every non-principal, and for a school running one head. */
  scoped: boolean;
  branchIds: string[] | null;
  gradeIds: string[] | null;
  /** The divisions this person heads, for the "you are seeing X" line. */
  divisions: string[];
  /**
   * True when the person is a principal at a `multiple` school and has no
   * assignment at all. They see nothing, and the screens must say who to ask —
   * an unassigned head staring at an empty school with no explanation is the
   * defect this flag exists to prevent.
   */
  unassigned: boolean;
}

/** The scope that narrows nothing. Everything non-principal gets this. */
export const UNSCOPED: PrincipalScope = {
  scoped: false,
  branchIds: null,
  gradeIds: null,
  divisions: [],
  unassigned: false,
};

/** One assignment, as the management screen shows it. */
export interface PrincipalAssignmentRow {
  id: string;
  schoolUserId: string;
  principalName: string;
  principalEmail: string | null;
  branchId: string | null;
  branchName: string | null;
  divisionName: string | null;
  gradeIds: string[];
  startsOn: string;
  endsOn: string | null;
}

/** Today, as a date-only string in the same form the columns hold. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Whether a school runs one head or several.
 *
 * Request-memoised because the scope resolver and the settings screen both ask,
 * and it is one indexed lookup on a table already in every request's path.
 */
export const getPrincipalModel = cache(
  async (locationId: string): Promise<PrincipalModel> => {
    const rows = await db
      .select({ principalModel: schools.principalModel })
      .from(schools)
      .where(eq(schools.locationId, locationId))
      .limit(1);

    return rows[0]?.principalModel ?? 'single';
  },
);

/**
 * The assignments in force for one person today.
 *
 * "In force" is `starts_on <= today AND (ends_on IS NULL OR ends_on >= today)`.
 * Expired rows stay in the table — "who signed this report card in 2025" is a
 * question schools get asked — and are filtered here rather than deleted.
 */
async function activeAssignmentsFor(
  locationId: string,
  schoolUserId: string,
): Promise<
  { branchId: string | null; divisionName: string | null; gradeIds: string[] }[]
> {
  const now = today();

  return db
    .select({
      branchId: principalAssignments.branchId,
      divisionName: principalAssignments.divisionName,
      gradeIds: principalAssignments.gradeIds,
    })
    .from(principalAssignments)
    .where(
      and(
        eq(principalAssignments.locationId, locationId),
        eq(principalAssignments.schoolUserId, schoolUserId),
        lte(principalAssignments.startsOn, now),
        or(
          isNull(principalAssignments.endsOn),
          sql`${principalAssignments.endsOn} >= ${now}`,
        ),
      ),
    );
}

/**
 * The scope for one signed-in person.
 *
 * Request-memoised on the pair, because a page and its layout both ask and a
 * head's scope cannot change midway through rendering one screen.
 *
 * ── Several assignments union, they do not intersect ──────────────────────
 * A head of both the Girls' Wing and the Boys' Wing sees both. Intersecting
 * would make a second assignment *narrow* the first, which is the opposite of
 * what adding one means to whoever adds it.
 *
 * ── One unbounded assignment widens the lot ───────────────────────────────
 * An assignment with no branch and no grades is the "runs everything" row, and
 * a person holding it alongside a narrow one sees everything. That follows from
 * the union and is the arrangement a group with campus heads *and* an overall
 * head actually has.
 */
export const resolvePrincipalScope = cache(
  async (
    locationId: string,
    role: string,
    schoolUserId: string | null,
  ): Promise<PrincipalScope> => {
    if (role !== 'principal' || schoolUserId === null) return UNSCOPED;
    if ((await getPrincipalModel(locationId)) !== 'multiple') return UNSCOPED;

    const rows = await activeAssignmentsFor(locationId, schoolUserId);

    if (rows.length === 0) {
      return {
        scoped: true,
        branchIds: [],
        gradeIds: [],
        divisions: [],
        unassigned: true,
      };
    }

    // Null wins on each axis independently: a head assigned to "all campuses,
    // O-Levels" and to "Main campus, all grades" reaches every campus and every
    // grade, which is what those two rows together say.
    const everyBranch = rows.some((row) => row.branchId === null);
    const everyGrade = rows.some((row) => row.gradeIds.length === 0);

    const branchIds = everyBranch
      ? null
      : [...new Set(rows.map((row) => row.branchId).filter((id): id is string => id !== null))];

    const gradeIds = everyGrade
      ? null
      : [...new Set(rows.flatMap((row) => row.gradeIds))];

    const divisions = [
      ...new Set(
        rows
          .map((row) => row.divisionName)
          .filter((name): name is string => name !== null && name !== ''),
      ),
    ].sort();

    return { scoped: true, branchIds, gradeIds, divisions, unassigned: false };
  },
);

/**
 * Whether a scope admits a branch. Used by screens that show one campus.
 *
 * A null `branchId` on the *thing being checked* means "not tied to a campus"
 * — a school-wide announcement, a student with no branch — and is admitted by
 * any scope. Refusing it would hide school-wide records from every head, which
 * is nobody's reading of "runs the O-Levels".
 */
export function scopeAdmitsBranch(scope: PrincipalScope, branchId: string | null): boolean {
  if (!scope.scoped || scope.branchIds === null) return true;
  if (branchId === null) return true;
  return scope.branchIds.includes(branchId);
}

/** Whether a scope admits a grade. A null grade is admitted, as above. */
export function scopeAdmitsGrade(scope: PrincipalScope, gradeId: string | null): boolean {
  if (!scope.scoped || scope.gradeIds === null) return true;
  if (gradeId === null) return true;
  return scope.gradeIds.includes(gradeId);
}

/** One line naming what a head is looking at, for the top of their screens. */
export function describeScope(scope: PrincipalScope): string | null {
  if (!scope.scoped) return null;
  if (scope.unassigned) {
    return 'You have no division assigned yet. Ask your school administrator to assign one.';
  }

  const parts: string[] = [];
  if (scope.divisions.length > 0) parts.push(scope.divisions.join(' and '));
  if (scope.gradeIds !== null && scope.gradeIds.length === 0) {
    return `You head ${
      parts.length > 0 ? parts.join(', ') : 'a division'
    }, which has no classes assigned to it yet.`;
  }

  if (parts.length === 0) return null;
  return `You are seeing ${parts.join(' and ')}.`;
}

/**
 * Every assignment at a school, current and past, for the management screen.
 *
 * Past rows are included on purpose — the screen shows them under "Ended", and
 * an administrator wondering why a former head still appears in an old audit
 * trail needs to be able to see that the assignment ended rather than that it
 * never existed.
 */
export async function listPrincipalAssignments(
  locationId: string,
): Promise<PrincipalAssignmentRow[]> {
  return db
    .select({
      id: principalAssignments.id,
      schoolUserId: principalAssignments.schoolUserId,
      principalName: schoolUsers.name,
      principalEmail: schoolUsers.email,
      branchId: principalAssignments.branchId,
      branchName: branches.name,
      divisionName: principalAssignments.divisionName,
      gradeIds: principalAssignments.gradeIds,
      startsOn: principalAssignments.startsOn,
      endsOn: principalAssignments.endsOn,
    })
    .from(principalAssignments)
    .innerJoin(schoolUsers, eq(schoolUsers.id, principalAssignments.schoolUserId))
    .leftJoin(branches, eq(branches.id, principalAssignments.branchId))
    .where(eq(principalAssignments.locationId, locationId))
    .orderBy(asc(schoolUsers.name), asc(principalAssignments.startsOn));
}

/** The people who can be assigned: this school's principals. */
export async function listAssignablePrincipals(
  locationId: string,
): Promise<{ id: string; name: string; email: string | null }[]> {
  return db
    .select({ id: schoolUsers.id, name: schoolUsers.name, email: schoolUsers.email })
    .from(schoolUsers)
    .where(
      and(
        eq(schoolUsers.locationId, locationId),
        eq(schoolUsers.role, 'principal'),
        eq(schoolUsers.isActive, true),
      ),
    )
    .orderBy(asc(schoolUsers.name));
}

/** Whether an assignment is in force today — the screen's Current/Ended split. */
export function assignmentIsCurrent(row: PrincipalAssignmentRow): boolean {
  const now = today();
  if (row.startsOn > now) return false;
  return row.endsOn === null || row.endsOn >= now;
}
