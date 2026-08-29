import { and, eq } from 'drizzle-orm';

import { academicYears, grades, sections } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { listSections } from '@/lib/admissions-queries';
import { db } from '@/lib/drizzle';
import { listClassTeacherCandidates } from '@/lib/exam-queries';
import { isUuid, readString } from '@/lib/validation';

/**
 * /api/school/sections
 *
 * GET  sections, filtered by grade and/or academic year
 * POST create one
 *
 * Sections are per (grade, academic year): last year's Class 5 A and this
 * year's are different rows, so last year's enrollments keep pointing at the
 * group that actually existed then.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';


export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);

      // The class-teacher candidates ride along: the setup grid draws a picker
      // per section, and asking for the same short list once per row would be
      // one request per class on a screen that already has sixteen.
      const [rows, classTeachers] = await Promise.all([
        listSections(auth.locationId, {
          gradeId: url.searchParams.get('gradeId') ?? undefined,
          academicYearId: url.searchParams.get('academicYearId') ?? undefined,
        }),
        listClassTeacherCandidates(auth.locationId, auth.branchId),
      ]);

      return apiSuccess({ sections: rows, classTeachers });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'admissions.read' },
);

interface CreateSectionBody {
  gradeId?: unknown;
  academicYearId?: unknown;
  name?: unknown;
  capacity?: unknown;
}

/** Reads an optional positive integer, or null. Returns undefined when invalid. */
function readCapacity(value: unknown): number | null | undefined {
  if (value === undefined || value === null || value === '') return null;

  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) return undefined;

  return parsed;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<CreateSectionBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const gradeId = readString(body.gradeId);
      const academicYearId = readString(body.academicYearId);
      const name = readString(body.name);

      if (!isUuid(gradeId)) {
        return apiFailure('invalid_body', 'Select a grade.', 400);
      }
      if (!isUuid(academicYearId)) {
        return apiFailure('invalid_body', 'Select an academic year.', 400);
      }
      if (name === '') {
        return apiFailure('invalid_body', 'Give the section a name, e.g. A.', 400);
      }
      if (name.length > 40) {
        return apiFailure('invalid_body', 'Section names must be 40 characters or fewer.', 400);
      }

      const capacity = readCapacity(body.capacity);
      if (capacity === undefined) {
        return apiFailure('invalid_body', 'Capacity must be a whole number between 1 and 500.', 400);
      }

      // Both parents must belong to this school. Foreign keys alone would not
      // catch an id borrowed from another tenant.
      const [gradeRows, yearRows] = await Promise.all([
        db
          .select({ id: grades.id, branchId: grades.branchId })
          .from(grades)
          .where(and(eq(grades.id, gradeId), eq(grades.locationId, auth.locationId)))
          .limit(1),
        db
          .select({ id: academicYears.id })
          .from(academicYears)
          .where(
            and(
              eq(academicYears.id, academicYearId),
              eq(academicYears.locationId, auth.locationId),
            ),
          )
          .limit(1),
      ]);

      const grade = gradeRows[0];
      if (grade === undefined) {
        return apiFailure('invalid_body', 'That grade does not exist.', 400);
      }
      if (yearRows[0] === undefined) {
        return apiFailure('invalid_body', 'That academic year does not exist.', 400);
      }

      if (auth.branchId !== null && grade.branchId !== auth.branchId) {
        return apiFailure('forbidden', 'You can only manage your own branch.', 403);
      }

      const inserted = await db
        .insert(sections)
        .values({
          locationId: auth.locationId,
          gradeId,
          academicYearId,
          name,
          capacity,
        })
        // Unique on (grade_id, academic_year_id, name).
        .onConflictDoNothing()
        .returning();

      const section = inserted[0];
      if (section === undefined) {
        return apiFailure(
          'already_exists',
          `This grade already has a section called ${name} in that academic year.`,
          409,
        );
      }

      return apiSuccess({ section }, 201);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'admissions.write' },
);
