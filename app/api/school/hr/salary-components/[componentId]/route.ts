import { and, eq, ne } from 'drizzle-orm';

import { isComponentCalculation, salaryComponents } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { getSalaryComponent } from '@/lib/hr-queries';
import { isUuid, readBoolean, readOptionalString, readString } from '@/lib/validation';
import { HR_READ_ROLES, HR_WRITE_ROLES } from '@/types/school-auth';

/**
 * /api/school/hr/salary-components/[componentId]
 *
 * GET   one component
 * PATCH rename it, recategorise it, or retire it
 *
 * There is no DELETE, for the same reason `fee_types` has none: a component
 * that has ever appeared on a payslip is referenced by that payslip's lines,
 * and a payslip a teacher was handed has to stay explainable. Retiring it with
 * `isActive: false` keeps it out of future runs.
 *
 * The `kind` is deliberately not editable. Flipping an earning to a deduction
 * would silently invert what every existing staff structure means, turning an
 * allowance into a cut in everyone's pay the next time payroll ran.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ componentId: string }> };

export const GET = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { componentId } = await context.params;
      if (!isUuid(componentId)) {
        return apiFailure('not_found', 'Salary component not found.', 404);
      }

      const component = await getSalaryComponent(auth.locationId, componentId);
      if (component === null) {
        return apiFailure('not_found', 'Salary component not found.', 404);
      }

      return apiSuccess({ component });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: HR_READ_ROLES },
);

interface UpdateComponentBody {
  name?: unknown;
  description?: unknown;
  calculation?: unknown;
  defaultPercentBasisPoints?: unknown;
  isBasic?: unknown;
  proratedByAttendance?: unknown;
  isActive?: unknown;
  sortOrder?: unknown;
}

export const PATCH = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { componentId } = await context.params;
      if (!isUuid(componentId)) {
        return apiFailure('not_found', 'Salary component not found.', 404);
      }

      const existing = await getSalaryComponent(auth.locationId, componentId);
      if (existing === null) {
        return apiFailure('not_found', 'Salary component not found.', 404);
      }

      const body = await readJsonBody<UpdateComponentBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const updates: Partial<typeof salaryComponents.$inferInsert> = {};

      if (body.name !== undefined) {
        const name = readString(body.name);
        if (name === '' || name.length > 80) {
          return apiFailure(
            'invalid_body',
            'Enter a component name of 80 characters or fewer.',
            400,
          );
        }
        updates.name = name;
      }

      if (body.description !== undefined) {
        updates.description = readOptionalString(body.description);
      }

      const calculation = isComponentCalculation(body.calculation)
        ? body.calculation
        : existing.calculation;

      if (body.calculation !== undefined) {
        if (!isComponentCalculation(body.calculation)) {
          return apiFailure(
            'invalid_body',
            'Choose whether this component is a fixed amount or a share of basic.',
            400,
          );
        }
        updates.calculation = body.calculation;
      }

      if (body.defaultPercentBasisPoints !== undefined || calculation === 'percent_of_basic') {
        if (calculation === 'percent_of_basic') {
          const points = Number(
            body.defaultPercentBasisPoints ?? existing.defaultPercentBasisPoints ?? 0,
          );
          if (!Number.isInteger(points) || points < 0 || points > 100_000) {
            return apiFailure(
              'invalid_body',
              'Enter a percentage between 0 and 1000.',
              400,
            );
          }
          updates.defaultPercentBasisPoints = points;
        } else {
          updates.defaultPercentBasisPoints = null;
        }
      }

      let becameBasic = false;
      if (body.isBasic !== undefined) {
        const isBasic = readBoolean(body.isBasic, existing.isBasic);
        if (isBasic && existing.kind === 'deduction') {
          return apiFailure('invalid_body', 'The basic salary must be an earning.', 400);
        }
        updates.isBasic = isBasic;
        becameBasic = isBasic;
      }

      if (body.proratedByAttendance !== undefined) {
        updates.proratedByAttendance = readBoolean(
          body.proratedByAttendance,
          existing.proratedByAttendance,
        );
      }

      if (body.isActive !== undefined) {
        updates.isActive = readBoolean(body.isActive, existing.isActive);
      }

      if (body.sortOrder !== undefined) {
        const sortOrder = Number(body.sortOrder);
        if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 999) {
          return apiFailure(
            'invalid_body',
            'The display order must be a whole number between 0 and 999.',
            400,
          );
        }
        updates.sortOrder = sortOrder;
      }

      if (Object.keys(updates).length === 0) {
        return apiFailure('invalid_body', 'No fields to update.', 400);
      }

      const updated = await db
        .update(salaryComponents)
        .set(updates)
        .where(
          and(
            eq(salaryComponents.id, componentId),
            eq(salaryComponents.locationId, auth.locationId),
          ),
        )
        .returning({ id: salaryComponents.id });

      if (updated[0] === undefined) {
        return apiFailure('not_found', 'Salary component not found.', 404);
      }

      // Exactly one basic per school — see the POST route for why.
      if (becameBasic) {
        await db
          .update(salaryComponents)
          .set({ isBasic: false })
          .where(
            and(
              eq(salaryComponents.locationId, auth.locationId),
              ne(salaryComponents.id, componentId),
            ),
          );
      }

      return apiSuccess({
        component: await getSalaryComponent(auth.locationId, componentId),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: HR_WRITE_ROLES },
);
