import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { listStudents } from '@/lib/admissions-queries';
import { db } from '@/lib/drizzle';
import {
  enrollStudent,
  EnrollmentError,
  parseGuardians,
  parsePlacement,
  parseStudentInput,
  syncEnrollmentToGhl,
} from '@/lib/enrollment';
import { StudentIdError } from '@/lib/student-id';

/**
 * /api/school/students
 *
 * GET  the enrolled-student directory, filtered and paginated
 * POST enrol a student directly
 *
 * ── On the shape of POST ─────────────────────────────────────────────────
 * One request creates four rows across four tables: the directory entry, the
 * profile, the placement and the guardians. They go out as a single batched
 * transaction (see `lib/enrollment.ts`), because a child who exists in the
 * directory but has no placement is worse than a child who was not admitted.
 *
 * The GHL sync deliberately runs *after* that transaction and cannot roll it
 * back. A school whose CRM connection has lapsed must still be able to admit
 * students; anything the sync misses is replayable from the profile page.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const READ_ROLES = [
  'school_admin',
  'branch_admin',
  'teacher',
  'hr_manager',
  'accountant',
] as const;

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);

      const pageRaw = Number.parseInt(url.searchParams.get('page') ?? '1', 10);
      const limitRaw = Number.parseInt(url.searchParams.get('limit') ?? '20', 10);

      // A branch-scoped admin is confined to their branch regardless of input.
      const branchId = auth.branchId ?? (url.searchParams.get('branchId') ?? undefined);

      const result = await listStudents(auth.locationId, {
        branchId: branchId ?? undefined,
        gradeId: url.searchParams.get('gradeId') ?? undefined,
        sectionId: url.searchParams.get('sectionId') ?? undefined,
        academicYearId: url.searchParams.get('academicYearId') ?? undefined,
        status: url.searchParams.get('status') ?? undefined,
        search: url.searchParams.get('search') ?? undefined,
        page: Number.isFinite(pageRaw) ? pageRaw : 1,
        limit: Number.isFinite(limitRaw) ? limitRaw : 20,
      });

      return apiSuccess(result);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: READ_ROLES },
);

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<Record<string, unknown>>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const student = parseStudentInput(body);
      const guardians = parseGuardians(body['guardians']);
      const placement = parsePlacement(body);

      if (auth.branchId !== null && auth.branchId !== placement.branchId) {
        return apiFailure(
          'forbidden',
          'You can only enrol students into your own branch.',
          403,
        );
      }

      const enrolled = await enrollStudent(db, {
        // Tenant comes from the verified session, never from the body.
        locationId: auth.locationId,
        actorUid: auth.uid,
        student,
        guardians,
        placement,
      });

      const sync = await syncEnrollmentToGhl(
        db,
        auth.locationId,
        enrolled,
        student.name,
      );

      return apiSuccess(
        {
          student: {
            studentProfileId: enrolled.studentProfileId,
            studentId: enrolled.studentId,
            schoolUserId: enrolled.schoolUserId,
          },
          enrolled: true,
          ghl: {
            studentContactId: sync.studentContactId,
            guardiansSynced: Object.keys(sync.guardianContactIds).length,
          },
        },
        201,
      );
    } catch (error) {
      if (error instanceof EnrollmentError) {
        return apiFailure(error.code, error.message, error.status);
      }
      if (error instanceof StudentIdError) {
        return apiFailure('student_id_failed', error.message, 409);
      }
      return handleApiError(error);
    }
  },
  { allowedRoles: ['school_admin', 'branch_admin'] },
);
