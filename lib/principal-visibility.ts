import 'server-only';

import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { cache } from 'react';

import { grades, sections } from '@/db/schema';

import { db } from './drizzle';
import {
  describeScope,
  resolvePrincipalScope,
  UNSCOPED,
  type PrincipalScope,
} from './principal-resolver';
import { getSchoolUserByUid } from './school-queries';

/**
 * `lib/principal-visibility.ts` — BR4, wired into the rest of the product.
 *
 * ── This is not a second resolver ────────────────────────────────────────
 * `lib/principal-resolver.ts` is still the only thing that decides what a head
 * may see, and every function here calls it. What this module adds is the two
 * shapes the *queries* need — a list of grade ids and a list of section ids —
 * plus the one line of plumbing that turns a signed-in session into a scope.
 *
 * Sprint 13 shipped the resolver and wired it into four surfaces: the students
 * page, `GET /api/school/students`, the school-admin dashboard and portal
 * search. **Everything else showed a head the whole school.** Sprint 23, item
 * 3 is that wiring, and it is wiring rather than design precisely because the
 * decision was already made and written down.
 *
 * ── It narrows sight, and only sight ─────────────────────────────────────
 * Restating the product owner's decision, in the words `SPRINT-23-SPEC.md` §3
 * requires to be carried into the code:
 *
 * > **This is a visibility filter, not an authorization boundary.** A
 * > principal's screens show only their grades and every grade/section
 * > dropdown offers only their grades. **A crafted API request outside their
 * > scope still succeeds.** That is a deliberate, recorded product decision and
 * > not an oversight.
 *
 * So nothing here returns 403 and nothing here belongs in a write path. A route
 * that forgets to call it shows a head more than it meant to, which is a defect
 * and not a breach — `location_id` still comes from the verified session, and
 * nothing in this module relaxes that.
 *
 * ── Unscoped must stay free ──────────────────────────────────────────────
 * Every function short-circuits to "no filter" for a school on
 * `principal_model = 'single'` and for every non-principal role, without
 * touching the database. That is what makes it safe to call from anywhere: at
 * a school that has never opted in, adding the call costs one memoised
 * `schools` lookup and changes no screen.
 */

/** What a caller's screens are narrowed to. `null` on an axis means "all". */
export interface VisibleScope {
  /** False when nothing is narrowed. Every field below is then null/empty. */
  scoped: boolean;
  /**
   * The concrete grade ids this person may be shown, or null for every grade.
   *
   * An **empty array** is a real answer and is not the same as null: a head
   * with no assignment, or one whose division has been given no classes,
   * reaches nothing. Every caller must read it as "matches no row" — treating
   * it as "no filter" hands them the whole school on a screen that looks
   * entirely normal, which is the single dangerous mistake in this module.
   */
  gradeIds: string[] | null;
  /** The campuses, straight off the assignment. Null for every campus. */
  branchIds: string[] | null;
  /** True for a head at a `multiple` school with no assignment at all. */
  unassigned: boolean;
  /**
   * The sentence a narrowed screen prints above its list, or null.
   *
   * `describeScope()`'s own output, carried here so a page gets the filter and
   * the explanation from one call. A narrowed list and a broken list look
   * identical, and this is the only thing that tells them apart — including
   * for the unassigned head, whom it tells who to ask.
   */
  note: string | null;
}

/** The scope that narrows nothing, as this module's shape. */
export const VISIBLE_EVERYTHING: VisibleScope = {
  scoped: false,
  gradeIds: null,
  branchIds: null,
  unassigned: false,
  note: null,
};

/**
 * The signed-in caller's principal scope, from a session rather than a row id.
 *
 * `resolvePrincipalScope` takes a `school_users.id` and every route has an auth
 * uid, so this pairing was being written out by hand at each of the four
 * existing call sites. Memoised on the pair, like the resolver itself, so a
 * page and its layout asking the same question cost one read.
 */
export const scopeForCaller = cache(
  async (
    locationId: string,
    role: string,
    uid: string,
  ): Promise<PrincipalScope> => {
    // The cheap test first: a non-principal never needs the directory lookup,
    // and a non-principal is who almost every request is.
    if (role !== 'principal') return UNSCOPED;

    const me = await getSchoolUserByUid(locationId, uid);
    return resolvePrincipalScope(locationId, role, me?.id ?? null);
  },
);

/**
 * The grade ids a scope admits, resolved against this school's own ladder.
 *
 * ── The two axes collapse into grades ────────────────────────────────────
 * Exactly as `resolveDashboardScope` does it, and for the same reason: a
 * campus reaches its data through its grades (`grades.branch_id`), so
 * resolving both axes into one list means every downstream query takes one
 * argument and "is this query scoped" is answerable by reading one line of it.
 *
 * ── A grade with no campus belongs to every head ─────────────────────────
 * `grades.branch_id` is nullable, and a null one is a school-wide grade. A
 * single-campus school that never created a branch record has **every** grade
 * null, and excluding them would show every one of its heads an empty school.
 * `scopeAdmitsBranch` admits a null branch for exactly this reason and so does
 * this.
 */
export const visibleGradeIds = cache(
  async (locationId: string, scope: PrincipalScope): Promise<string[] | null> => {
    if (!scope.scoped) return null;
    if (scope.unassigned) return [];
    if (scope.branchIds === null && scope.gradeIds === null) return null;

    const rows = await db
      .select({ id: grades.id })
      .from(grades)
      .where(
        and(
          eq(grades.locationId, locationId),
          scope.branchIds === null
            ? undefined
            : scope.branchIds.length === 0
              ? isNull(grades.branchId)
              : or(isNull(grades.branchId), inArray(grades.branchId, scope.branchIds)),
          scope.gradeIds === null
            ? undefined
            : scope.gradeIds.length === 0
              ? // `inArray` with an empty list is already `false` in Drizzle,
                // but saying it outright is what stops the next reader deleting
                // the branch as dead code.
                sql`false`
              : inArray(grades.id, scope.gradeIds),
        ),
      );

    return rows.map((row) => row.id);
  },
);

/**
 * The sections inside a grade list, for the queries keyed on a section.
 *
 * Attendance registers, timetable entries, marks sheets and result cards all
 * hang off `section_id` rather than `grade_id`, so they need this rather than
 * a join they would each have to add. `null` in, `null` out — an unscoped
 * caller never pays for the read.
 *
 * Every section, active and not: an archived section still has last year's
 * register against it, and hiding it would make a head's own history vanish
 * from their own screens.
 */
export const visibleSectionIds = cache(
  async (locationId: string, gradeIds: string[] | null): Promise<string[] | null> => {
    if (gradeIds === null) return null;
    if (gradeIds.length === 0) return [];

    const rows = await db
      .select({ id: sections.id })
      .from(sections)
      .where(
        and(eq(sections.locationId, locationId), inArray(sections.gradeId, gradeIds)),
      );

    return rows.map((row) => row.id);
  },
);

/**
 * The whole answer for one request, in the shape the routes want.
 *
 * One call, one object, and the object is safe to spread into a query's
 * filters. A route that only needs the grade list can read `.gradeIds`; a page
 * that also has to explain itself reads `.unassigned` and calls
 * `describeScope` on the resolver's own value.
 */
export async function visibleScopeFor(auth: {
  locationId: string;
  role: string;
  uid: string;
}): Promise<VisibleScope> {
  const scope = await scopeForCaller(auth.locationId, auth.role, auth.uid);
  if (!scope.scoped) return VISIBLE_EVERYTHING;

  return {
    scoped: true,
    gradeIds: await visibleGradeIds(auth.locationId, scope),
    branchIds: scope.branchIds,
    unassigned: scope.unassigned,
    note: describeScope(scope),
  };
}

/**
 * The two list narrowings every screen in item 3 needs, written once.
 *
 * In JavaScript rather than in the `WHERE`, and that is a deliberate trade
 * rather than laziness. These lists are a school's grade ladder and its section
 * list — tens of rows, already fetched, already sorted. Pushing the filter into
 * each of the fourteen callers' queries would mean fourteen new `inArray`s
 * against fourteen slightly different statements, every one of which is a
 * chance to write the ambiguous reference CLAUDE.md records shipping three
 * times. The *student*, *voucher* and *register* queries — the ones that are
 * thousands of rows and paginated in the database — are narrowed in SQL, where
 * that trade goes the other way.
 */
export function narrowGrades<T extends { id: string }>(
  scope: VisibleScope,
  rows: readonly T[],
): T[] {
  if (scope.gradeIds === null) return [...rows];
  const admitted = new Set(scope.gradeIds);
  return rows.filter((row) => admitted.has(row.id));
}

/** The same, for anything hanging off a grade — sections, structures, exams. */
export function narrowByGrade<T extends { gradeId: string | null }>(
  scope: VisibleScope,
  rows: readonly T[],
): T[] {
  if (scope.gradeIds === null) return [...rows];
  const admitted = new Set(scope.gradeIds);
  // A null grade is admitted, exactly as `admitsGrade` admits it and for the
  // same reason. Nothing that is not tied to a class is hidden from a head.
  return rows.filter((row) => row.gradeId === null || admitted.has(row.gradeId));
}

/**
 * Whether a scope admits one grade. The per-record test, for detail screens.
 *
 * A **null** grade is admitted, deliberately and permanently: a student not yet
 * placed, a school-wide announcement, an application with no class chosen.
 * Hiding grade-less records from every head is nobody's reading of "runs the
 * O-Levels", and it would make an unplaced admission invisible to the only
 * person who could place it.
 */
export function admitsGrade(scope: VisibleScope, gradeId: string | null): boolean {
  if (!scope.scoped || scope.gradeIds === null) return true;
  if (gradeId === null) return true;
  return scope.gradeIds.includes(gradeId);
}
