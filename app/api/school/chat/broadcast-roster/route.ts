import { and, asc, eq, inArray } from 'drizzle-orm';

import { schoolUsers } from '@/db/schema/school-users';
import { studentEnrollments } from '@/db/schema/student-enrollments';
import { studentProfiles } from '@/db/schema/student-profiles';
import { getActiveAcademicYear } from '@/lib/admissions-queries';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { grantScopeProblem } from '@/lib/chat-grant-scope';
import { db } from '@/lib/drizzle';
import { getSchoolUserByUid } from '@/lib/school-queries';

/**
 * /api/school/chat/broadcast-roster — the names behind "or pick individuals".
 *
 * ── Why this is not the class roster route that already exists ───────────
 * `listSectionRoster` answers with roll numbers, photographs and profile ids
 * for a register. This answers with a name and an id, for a checkbox list, and
 * it answers for **several sections at once** — which is what the composer asks
 * for and what a per-section route would turn into six round trips.
 *
 * ── Every section is re-derived ──────────────────────────────────────────
 * A section id in a query string is untrusted exactly as one in a body is.
 * `grantScopeProblem` resolves what this person may actually reach from the
 * timetable, so a crafted id returns a class the caller already teaches or is
 * refused. Without that, this would be a roll enumerator for the whole school.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A blast-radius limit on the query string itself. */
const MAX_SECTIONS = 20;

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const sectionIds = [
        ...new Set(new URL(request.url).searchParams.getAll('sectionId').filter((id) => id !== '')),
      ];

      if (sectionIds.length === 0) return apiSuccess({ students: [] });
      if (sectionIds.length > MAX_SECTIONS) {
        return apiFailure('invalid_query', 'That is too many classes at once.', 400);
      }

      const me = await getSchoolUserByUid(auth.locationId, auth.uid);
      if (me === null) return apiFailure('not_found', 'No account at this school.', 404);

      for (const sectionId of sectionIds) {
        const problem = await grantScopeProblem(auth, me.id, 'section', sectionId);
        if (problem !== null) return apiFailure('refused', problem, 403);
      }

      const year = await getActiveAcademicYear(auth.locationId);
      if (year === null) return apiSuccess({ students: [] });

      const students = await db
        .selectDistinct({
          studentProfileId: studentProfiles.id,
          name: schoolUsers.name,
        })
        .from(studentEnrollments)
        .innerJoin(studentProfiles, eq(studentProfiles.id, studentEnrollments.studentProfileId))
        .innerJoin(schoolUsers, eq(schoolUsers.id, studentProfiles.schoolUserId))
        .where(
          and(
            eq(studentEnrollments.locationId, auth.locationId),
            eq(studentEnrollments.academicYearId, year.id),
            eq(studentEnrollments.status, 'active'),
            eq(schoolUsers.isActive, true),
            inArray(studentEnrollments.sectionId, sectionIds),
          ),
        )
        .orderBy(asc(schoolUsers.name));

      return apiSuccess({ students });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'chat.send' },
);
