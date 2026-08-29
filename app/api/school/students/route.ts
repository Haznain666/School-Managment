import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { listStudents, STUDENT_SORT_COLUMNS } from '@/lib/admissions-queries';
import { db } from '@/lib/drizzle';
import {
  enrollStudent,
  EnrollmentError,
  parseGuardians,
  parsePlacement,
  parseStudentInput,
  syncEnrollmentToGhl,
} from '@/lib/enrollment';
import { readListQuery } from '@/lib/list-query';
import { resolvePrincipalScope } from '@/lib/principal-resolver';
import { getSchoolUserByUid } from '@/lib/school-queries';
import { StudentIdError } from '@/lib/student-id';

/**
 * /api/school/students
 *
 * GET  the enrolled-student directory, filtered and paginated
 * POST enroll a student directly
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
 *
 * ── The permissions moved in Sprint 18 ───────────────────────────────────
 * `students.read` and `students.create` rather than `admissions.read` and
 * `admissions.write`. The defaults in `lib/permissions.ts` hand the new keys to
 * exactly the roles that held the old ones, so no school's access changes on
 * the day this deploys — what changes is that a school *can* now separate
 * "may look at the roll" from "may decide an application".
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';


export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);

      // Page size, sort column and direction, all capped and whitelisted in
      // one place — `readListQuery` is where the 100-row ceiling lives on the
      // server, because the browser's copy of it protects nobody who types a
      // URL.
      const list = readListQuery(url.searchParams, {
        sortable: STUDENT_SORT_COLUMNS,
        defaultSort: 'name',
        defaultDirection: 'asc',
        defaultLimit: 50,
      });

      // A branch-scoped admin is confined to their branch regardless of input.
      const branchId = auth.branchId ?? (url.searchParams.get('branchId') ?? undefined);

      // BR4 — a head at a school running several is confined to their own
      // campuses and classes, resolved from the session rather than the query.
      const me = await getSchoolUserByUid(auth.locationId, auth.uid);
      const scope = await resolvePrincipalScope(
        auth.locationId,
        auth.role,
        me?.id ?? null,
      );

      const result = await listStudents(auth.locationId, {
        branchId: branchId ?? undefined,
        ...(scope.scoped
          ? { scope: { branchIds: scope.branchIds, gradeIds: scope.gradeIds } }
          : {}),
        gradeId: url.searchParams.get('gradeId') ?? undefined,
        sectionId: url.searchParams.get('sectionId') ?? undefined,
        academicYearId: url.searchParams.get('academicYearId') ?? undefined,
        status: url.searchParams.get('status') ?? undefined,
        feeStatus: url.searchParams.get('feeStatus') ?? undefined,
        search: url.searchParams.get('search') ?? undefined,
        page: list.page,
        limit: list.limit,
        sort: list.sort,
        direction: list.direction,
      });

      return apiSuccess(result);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'students.read' },
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
          'You can only enroll students into your own branch.',
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
  { permission: 'students.create' },
);
