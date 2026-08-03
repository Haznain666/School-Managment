import { and, eq } from 'drizzle-orm';

import { schools, studentGuardians, studentProfiles } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { getStudentDetail, listGuardians } from '@/lib/admissions-queries';
import { db } from '@/lib/drizzle';
import { syncAdmissionContacts } from '@/lib/ghl-admissions';
import { isUuid } from '@/lib/validation';

/**
 * POST /api/school/students/[studentId]/sync-ghl
 *
 * Replays the CRM sync for one student and all of their guardians.
 *
 * Enrolment deliberately does not fail when GHL is unreachable, which means a
 * school can end up with records that have no contact id. This is how they are
 * repaired, without re-entering the child.
 *
 * Safe to run repeatedly: contacts are matched by phone number first, so a
 * re-sync reuses the existing GHL contact rather than creating a second one.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ studentId: string }> };

export const POST = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { studentId } = await context.params;
      if (!isUuid(studentId)) return apiFailure('not_found', 'Student not found.', 404);

      const student = await getStudentDetail(auth.locationId, studentId);
      if (student === null) return apiFailure('not_found', 'Student not found.', 404);

      if (auth.branchId !== null && student.branchId !== auth.branchId) {
        return apiFailure('not_found', 'Student not found.', 404);
      }

      const [guardians, schoolRows] = await Promise.all([
        listGuardians(auth.locationId, studentId),
        db
          .select({ name: schools.name })
          .from(schools)
          .where(eq(schools.locationId, auth.locationId))
          .limit(1),
      ]);

      const primary = guardians.find((guardian) => guardian.isPrimaryContact);

      const sync = await syncAdmissionContacts(db, auth.locationId, {
        schoolName: schoolRows[0]?.name ?? 'School',
        student: {
          name: student.name,
          studentId: student.studentId,
          phone: primary?.phone,
          email: student.email ?? undefined,
        },
        guardians: guardians.map((guardian) => ({
          id: guardian.id,
          name: guardian.name,
          phone: guardian.phone,
          email: guardian.email ?? undefined,
        })),
      });

      const writes: Array<Promise<unknown>> = [];

      if (sync.studentContactId !== null) {
        writes.push(
          db
            .update(studentProfiles)
            .set({ ghlContactId: sync.studentContactId, updatedAt: new Date() })
            .where(
              and(
                eq(studentProfiles.id, studentId),
                eq(studentProfiles.locationId, auth.locationId),
              ),
            ),
        );
      }

      for (const [guardianId, contactId] of Object.entries(sync.guardianContactIds)) {
        writes.push(
          db
            .update(studentGuardians)
            .set({ ghlContactId: contactId })
            .where(
              and(
                eq(studentGuardians.id, guardianId),
                eq(studentGuardians.locationId, auth.locationId),
              ),
            ),
        );
      }

      await Promise.all(writes);

      const guardianContactIds = Object.values(sync.guardianContactIds);

      return apiSuccess({
        // False when nothing at all reached GHL, so the UI can say so plainly
        // rather than claiming a success the school does not have.
        synced: sync.studentContactId !== null || guardianContactIds.length > 0,
        studentContactId: sync.studentContactId,
        guardianContactIds,
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'admissions.write' },
);
