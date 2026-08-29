import 'server-only';

import { and, eq } from 'drizzle-orm';

import { parentNav } from '@/components/parent/parent-nav';
import { schoolNav } from '@/components/school/school-nav';
import { studentNav } from '@/components/student/student-nav';
import { teacherNav } from '@/components/teacher/teacher-nav';
import { studentProfiles } from '@/db/schema';
import { ADMIN_PORTAL_ROLES, type UserRole } from '@/types/school-auth';

import { listTeacherSections } from './academics-queries';
import { getActiveAcademicYear } from './admissions-queries';
import { effectiveBranchIds, resolveBranchScope } from './branch-scope';
import { db } from './drizzle';
import { listClassTeacherSections } from './exam-queries';
import {
  searchParentPortal,
  searchPlatform,
  searchSchoolPortal,
  searchStudentPortal,
  searchTeacherPortal,
} from './global-search';
import { permissionsForRole } from './permission-queries';
import { emptyModuleFlags } from './platform-modules';
import { PLATFORM_SEARCH_PAGES } from './search-destinations';
import { resolveDashboardScope } from './school-dashboard';
import { getModuleFlags, getSchoolUserByUid } from './school-queries';
import { resolvePrincipalScope } from './principal-resolver';
import { searchPages } from './search-pages';
import { isSearchable, type SearchGroup, type SearchResults } from './search-types';
import { listPortalChildren } from './siblings';
import { staffIdForSchoolUser } from './staff-self-queries';

/**
 * Resolving a signed-in caller into their search scope, and running it.
 *
 * ── Why this is a module and not the body of a route ─────────────────────
 * Two callers need it: `GET /api/school/search`, which the header dropdown
 * polls, and `/dashboard/search`, which renders on the server. The results page
 * calling its own API would mean an HTTP round trip from the server to itself
 * with the session cookie forwarded by hand — measurably slower on a
 * deployment whose edge→origin hop is ~1s (§5aq), and one more place for the
 * cookie handling to be got subtly wrong.
 *
 * So the scope resolution lives here and both call it directly. What that
 * guarantees is the property worth having: the dropdown and the results page
 * cannot disagree about what a person may see, because there is one function
 * that decides it.
 */

export interface SearchSession {
  locationId: string;
  uid: string;
  role: UserRole;
  /**
   * The campus on the caller's membership row, or null for a school-wide one.
   *
   * Passed straight to `resolveBranchScope`, which is the only thing that reads
   * it — the boundary is decided there, not here. Optional so the two callers
   * could be migrated one at a time; both pass it now, and a caller that omits
   * it is treated as school-wide, which is what search did before Sprint 19a.
   */
  branchId?: string | null;
}

export async function searchForSession(
  session: SearchSession,
  rawQuery: string,
): Promise<SearchResults> {
  const query = rawQuery.trim();

  // Below two characters an ILIKE over five tables returns most of a school.
  // The query is echoed back so the caller can render "keep typing" rather than
  // "no results", which are different statements.
  if (!isSearchable(query)) return { query, groups: [], total: 0 };

  const me = await getSchoolUserByUid(session.locationId, session.uid);

  let groups: SearchGroup[] = [];
  let pages: SearchGroup | null = null;

  if (ADMIN_PORTAL_ROLES.includes(session.role)) {
    const [permissions, moduleFlags] = await Promise.all([
      permissionsForRole(session.locationId, session.role),
      getModuleFlags(session.locationId),
    ]);

    /*
     * BR4. A principal's search is narrowed by exactly the grade list their
     * dashboard is narrowed by — one resolution, so the two screens cannot
     * develop different opinions about what "yours" means. An unassigned head
     * resolves to `[]`, which every scoped query reads as "no rows"; the
     * dangerous inverse is treating it as "no filter", which hands them the
     * whole school on a screen that looks entirely normal.
     */
    const principalScope = await resolvePrincipalScope(
      session.locationId,
      session.role,
      me?.id ?? null,
    );
    /*
     * The campus boundary — Sprint 19a, item 2d.
     *
     * Search is the widest read in the product: it crosses nine modules in one
     * request and every hit links straight into the record. So this is where a
     * campus that leaks costs the most, and it is resolved through exactly the
     * function the dashboard and the reports use.
     *
     * No `?branch=` is honoured here. The search box has no campus control and
     * should not grow one — somebody typing a name wants it found, and a
     * selector that could hide the answer would be a filter on a search.
     * `effectiveBranchIds` therefore returns the caller's whole scope.
     */
    const branchScope = await resolveBranchScope(session.locationId, {
      uid: session.uid,
      branchId: session.branchId ?? null,
    });
    const branchIds = effectiveBranchIds(branchScope);

    const scope = await resolveDashboardScope(
      session.locationId,
      principalScope,
      branchIds,
    );

    const nav = schoolNav({
      role: session.role,
      permissions,
      moduleFlags: moduleFlags ?? emptyModuleFlags(),
    });

    groups = await searchSchoolPortal({
      locationId: session.locationId,
      query,
      permissions,
      scope: { gradeIds: scope.gradeIds },
      branchIds,
    });
    pages = searchPages(query, nav.items, nav.sections);
  } else if (session.role === 'teacher') {
    const staffId =
      me === null ? null : await staffIdForSchoolUser(session.locationId, me.id);
    const year = await getActiveAcademicYear(session.locationId);

    /*
     * Both lists, not just the timetable. A class teacher is responsible for a
     * section they may not be timetabled into, and searching for a child in
     * their own form class and getting nothing is the first thing they would
     * try.
     */
    const [taught, formClasses] =
      staffId === null || year === null
        ? [[], []]
        : await Promise.all([
            listTeacherSections(session.locationId, staffId, year.id),
            listClassTeacherSections(session.locationId, staffId),
          ]);

    const sectionIds = [
      ...new Set([
        ...taught.map((entry) => entry.sectionId),
        ...formClasses.map((entry) => entry.sectionId),
      ]),
    ];

    groups = await searchTeacherPortal({
      locationId: session.locationId,
      query,
      sectionIds,
    });
    pages = searchPages(query, teacherNav());
  } else if (session.role === 'parent') {
    const children = me === null ? [] : await listPortalChildren(session.locationId, me.id);

    groups = await searchParentPortal({
      locationId: session.locationId,
      query,
      studentProfileIds: children.map((child) => child.studentProfileId),
    });
    pages = searchPages(query, parentNav());
  } else if (session.role === 'student') {
    const profileId =
      me === null ? null : await studentProfileIdFor(session.locationId, me.id);

    groups = await searchStudentPortal({
      locationId: session.locationId,
      query,
      studentProfileId: profileId,
    });
    pages = searchPages(query, studentNav());
  }

  /*
   * Screens last. Somebody searching "Ahmed" wants a person; somebody searching
   * "payslips" gets one hit and it is the only one, so its position costs
   * nothing. Putting Screens first would push real records below the fold on
   * the common case.
   */
  const all = pages === null ? groups : [...groups, pages];

  return {
    query,
    groups: all,
    total: all.reduce((sum, entry) => sum + entry.hits.length, 0),
  };
}

/** The platform surface's equivalent. Cross-tenant, and takes no scope. */
export async function searchForPlatform(rawQuery: string): Promise<SearchResults> {
  const query = rawQuery.trim();
  if (!isSearchable(query)) return { query, groups: [], total: 0 };

  const groups = await searchPlatform(query);
  const pages = searchPages(query, PLATFORM_SEARCH_PAGES);
  const all = pages === null ? groups : [...groups, pages];

  return {
    query,
    groups: all,
    total: all.reduce((sum, entry) => sum + entry.hits.length, 0),
  };
}

/** This login's own student record, or null when they have none. */
async function studentProfileIdFor(
  locationId: string,
  schoolUserId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: studentProfiles.id })
    .from(studentProfiles)
    .where(
      and(
        eq(studentProfiles.locationId, locationId),
        eq(studentProfiles.schoolUserId, schoolUserId),
      ),
    )
    .limit(1);

  return row?.id ?? null;
}
