import { and, eq } from 'drizzle-orm';

import {
  isPrincipalModel,
  principalAssignments,
  schoolUsers,
  schools,
  MAX_DIVISION_NAME_LENGTH,
} from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { listGrades } from '@/lib/admissions-queries';
import {
  getPrincipalModel,
  listAssignablePrincipals,
  listPrincipalAssignments,
} from '@/lib/principal-resolver';
import { isIsoDate, isUuid, readOptionalString } from '@/lib/validation';

/**
 * /api/school/principals — BR4, who runs which campus or division.
 *
 * GET   the model, the assignments, and what can be assigned
 * PATCH the model itself (single ⇄ multiple)
 * POST  a new assignment
 *
 * Gated on `principals.manage`, which `school_admin` alone holds by default.
 * A principal deliberately does not: an assignment is what narrows a head to
 * their own division, and a head who could edit assignments could widen that
 * narrowing. See `lib/permissions.ts`.
 *
 * ── Switching the model back to `single` keeps the rows ──────────────────
 * PATCH does not delete assignments. A school that tries `multiple`, dislikes
 * it and switches back has its arrangement waiting if it switches again, and
 * the resolver ignores every row while the model is `single`. Deleting them
 * would make an accidental toggle destructive.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (_request, auth) => {
    try {
      const [principalModel, assignments, principals, grades] = await Promise.all([
        getPrincipalModel(auth.locationId),
        listPrincipalAssignments(auth.locationId),
        listAssignablePrincipals(auth.locationId),
        listGrades(auth.locationId),
      ]);

      return apiSuccess({ principalModel, assignments, principals, grades });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'principals.manage' },
);

interface ModelBody {
  principalModel?: unknown;
}

export const PATCH = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<ModelBody>(request);
      if (body === null || !isPrincipalModel(body.principalModel)) {
        return apiFailure(
          'invalid_body',
          'Choose one principal for the school, or separate principals.',
          400,
        );
      }

      await db
        .update(schools)
        .set({ principalModel: body.principalModel, updatedAt: new Date() })
        // Tenant from the verified session, never from the body.
        .where(eq(schools.locationId, auth.locationId));

      return apiSuccess({ principalModel: body.principalModel });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'principals.manage' },
);

interface AssignmentBody {
  schoolUserId?: unknown;
  branchId?: unknown;
  divisionName?: unknown;
  gradeIds?: unknown;
  startsOn?: unknown;
  endsOn?: unknown;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<AssignmentBody>(request);
      if (body === null) return apiFailure('invalid_body', 'Expected a JSON body.', 400);

      if (!isUuid(body.schoolUserId)) {
        return apiFailure('invalid_body', 'Choose a principal.', 400);
      }
      if (!isIsoDate(body.startsOn)) {
        return apiFailure('invalid_body', 'Give the date this assignment starts.', 400);
      }

      const endsOn = readOptionalString(body.endsOn);
      if (endsOn !== null && !isIsoDate(endsOn)) {
        return apiFailure('invalid_body', 'That end date is not a date.', 400);
      }
      if (endsOn !== null && endsOn < body.startsOn) {
        return apiFailure('invalid_body', 'An assignment cannot end before it starts.', 400);
      }

      const branchId = readOptionalString(body.branchId);
      if (branchId !== null && !isUuid(branchId)) {
        return apiFailure('invalid_body', 'That is not a campus.', 400);
      }

      const divisionName = readOptionalString(body.divisionName);
      if (divisionName !== null && divisionName.length > MAX_DIVISION_NAME_LENGTH) {
        return apiFailure(
          'invalid_body',
          `A division name is at most ${MAX_DIVISION_NAME_LENGTH} characters.`,
          400,
        );
      }

      const gradeIds = Array.isArray(body.gradeIds)
        ? body.gradeIds.filter((id): id is string => isUuid(id))
        : [];

      // The person being assigned must be a principal *at this school*. Without
      // this check an id from another tenant would be written into this
      // school's assignment list — the row would be tenant-correct and the
      // person it names would not be.
      const target = await db
        .select({ id: schoolUsers.id, role: schoolUsers.role })
        .from(schoolUsers)
        .where(
          and(
            eq(schoolUsers.locationId, auth.locationId),
            eq(schoolUsers.id, body.schoolUserId),
          ),
        )
        .limit(1);

      if (target[0] === undefined) {
        return apiFailure('not_found', 'No such member at this school.', 404);
      }
      if (target[0].role !== 'principal') {
        return apiFailure(
          'invalid_body',
          'Only a member whose role is Principal can be given a division.',
          400,
        );
      }

      // Grades are checked against this school's own list for the same reason.
      if (gradeIds.length > 0) {
        const known = new Set((await listGrades(auth.locationId)).map((row) => row.id));
        if (gradeIds.some((id) => !known.has(id))) {
          return apiFailure('invalid_body', 'One of those classes is not this school’s.', 400);
        }
      }

      const [created] = await db
        .insert(principalAssignments)
        .values({
          locationId: auth.locationId,
          schoolUserId: body.schoolUserId,
          branchId,
          divisionName,
          gradeIds,
          startsOn: body.startsOn,
          endsOn,
        })
        .returning({ id: principalAssignments.id });

      return apiSuccess({ id: created?.id ?? null }, 201);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'principals.manage' },
);
