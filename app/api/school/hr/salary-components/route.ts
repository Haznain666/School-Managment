import { and, eq, ne } from 'drizzle-orm';

import { isComponentCalculation, isComponentKind, salaryComponents } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { listSalaryComponents } from '@/lib/hr-queries';
import { readBoolean, readOptionalString, readString } from '@/lib/validation';
import { HR_READ_ROLES, HR_WRITE_ROLES } from '@/types/school-auth';

/**
 * /api/school/hr/salary-components
 *
 * GET  the school's salary heads
 * POST create one
 *
 * ── On the basic-salary flag ─────────────────────────────────────────────
 * Every `percent_of_basic` head is measured against whichever component
 * carries `isBasic`. Two of them would make "45% of basic" ambiguous and the
 * answer would depend on row order, so setting the flag clears it everywhere
 * else in the same school. That is done as a second statement rather than a
 * constraint because Postgres cannot express "at most one true per tenant"
 * without a partial unique index, and a failed insert is a worse experience
 * than a silently corrected one here.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);
      const activeOnly = url.searchParams.get('activeOnly') === 'true';

      return apiSuccess({
        components: await listSalaryComponents(auth.locationId, { activeOnly }),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: HR_READ_ROLES },
);

interface CreateComponentBody {
  name?: unknown;
  description?: unknown;
  kind?: unknown;
  calculation?: unknown;
  defaultPercentBasisPoints?: unknown;
  isBasic?: unknown;
  proratedByAttendance?: unknown;
  sortOrder?: unknown;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<CreateComponentBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const name = readString(body.name);
      if (name === '' || name.length > 80) {
        return apiFailure(
          'invalid_body',
          'Enter a component name of 80 characters or fewer.',
          400,
        );
      }

      if (!isComponentKind(body.kind)) {
        return apiFailure(
          'invalid_body',
          'Choose whether this component is an earning or a deduction.',
          400,
        );
      }

      const calculation = isComponentCalculation(body.calculation)
        ? body.calculation
        : 'fixed';

      let percentPoints: number | null = null;
      if (calculation === 'percent_of_basic') {
        percentPoints = Number(body.defaultPercentBasisPoints ?? 0);
        if (
          !Number.isInteger(percentPoints) ||
          percentPoints < 0 ||
          percentPoints > 100_000
        ) {
          return apiFailure(
            'invalid_body',
            'Enter a percentage between 0 and 1000.',
            400,
          );
        }
      }

      const isBasic = readBoolean(body.isBasic, false);

      // A deduction cannot be the basic salary; that would make every
      // percentage head a share of a subtraction.
      if (isBasic && body.kind === 'deduction') {
        return apiFailure(
          'invalid_body',
          'The basic salary must be an earning.',
          400,
        );
      }

      const sortOrderRaw = Number(body.sortOrder ?? 0);
      const sortOrder =
        Number.isInteger(sortOrderRaw) && sortOrderRaw >= 0 && sortOrderRaw <= 999
          ? sortOrderRaw
          : 0;

      const created = await db
        .insert(salaryComponents)
        .values({
          // Tenant comes from the verified session, never from the body.
          locationId: auth.locationId,
          name,
          description: readOptionalString(body.description),
          kind: body.kind,
          calculation,
          defaultPercentBasisPoints: percentPoints,
          isBasic,
          proratedByAttendance: readBoolean(body.proratedByAttendance, true),
          sortOrder,
        })
        .onConflictDoNothing({
          target: [salaryComponents.locationId, salaryComponents.name],
        })
        .returning({ id: salaryComponents.id });

      if (created[0] === undefined) {
        return apiFailure(
          'duplicate',
          `Your school already has a component called "${name}".`,
          409,
        );
      }

      if (isBasic) {
        await db
          .update(salaryComponents)
          .set({ isBasic: false })
          .where(
            and(
              eq(salaryComponents.locationId, auth.locationId),
              ne(salaryComponents.id, created[0].id),
            ),
          );
      }

      return apiSuccess({ componentId: created[0].id }, 201);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: HR_WRITE_ROLES },
);
