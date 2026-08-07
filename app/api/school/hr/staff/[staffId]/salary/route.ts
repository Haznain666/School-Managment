import { and, eq } from 'drizzle-orm';

import { staffSalaryStructures } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { batch, db, type Tx } from '@/lib/drizzle';
import { getStaff, getStaffSalaryStructure, listSalaryComponents } from '@/lib/hr-queries';
import { paiseToNumeric, toPaise } from '@/lib/money';
import { isUuid } from '@/lib/validation';

/**
 * /api/school/hr/staff/[staffId]/salary
 *
 * GET   the salary structure assigned to one staff member
 * PATCH replace it
 *
 * PATCH rather than PUT because the request replaces the *set of assignments*
 * and nothing else about the staff member — the record itself is untouched.
 *
 * ── Why the whole set arrives at once ────────────────────────────────────
 * The screen is a matrix: every component the school has, with a figure against
 * the ones this person receives. Saving one row at a time would leave a
 * half-applied structure visible to a payroll run started in between, so the
 * whole set is written through `batch()` — one delete for the person's existing
 * assignments, then an insert per submitted row, all in one transaction.
 * Clearing and re-inserting rather than diffing means a component removed from
 * the matrix cannot survive because the diff missed it.
 *
 * Amounts are read as rupees and stored via `paiseToNumeric`, so a figure typed
 * as `12500.005` cannot round differently here than it does on the payslip.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ staffId: string }> };

/** One hundred million rupees. Anything above is a typo, not a salary. */
const MAX_COMPONENT_PAISE = 10_000_000_000;

export const GET = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { staffId } = await context.params;
      if (!isUuid(staffId)) {
        return apiFailure('not_found', 'Staff member not found.', 404);
      }

      const member = await getStaff(auth.locationId, staffId);
      if (member === null) {
        return apiFailure('not_found', 'Staff member not found.', 404);
      }

      const [structure, components] = await Promise.all([
        getStaffSalaryStructure(auth.locationId, staffId),
        listSalaryComponents(auth.locationId, { activeOnly: true }),
      ]);

      return apiSuccess({ structure, components });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'hr.read' },
);

interface AssignmentInput {
  componentId?: unknown;
  /** Rupees. Ignored for a percent-of-basic component. */
  amount?: unknown;
  percentBasisPoints?: unknown;
}

interface UpdateSalaryBody {
  assignments?: unknown;
}

export const PATCH = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { staffId } = await context.params;
      if (!isUuid(staffId)) {
        return apiFailure('not_found', 'Staff member not found.', 404);
      }

      const member = await getStaff(auth.locationId, staffId);
      if (member === null) {
        return apiFailure('not_found', 'Staff member not found.', 404);
      }

      const body = await readJsonBody<UpdateSalaryBody>(request);
      if (body === null || !Array.isArray(body.assignments)) {
        return apiFailure('invalid_body', 'Expected an "assignments" array.', 400);
      }

      const components = await listSalaryComponents(auth.locationId, { activeOnly: true });
      const byId = new Map(components.map((component) => [component.id, component]));

      const parsed: Array<{
        componentId: string;
        amount: string;
        percentBasisPoints: number | null;
      }> = [];

      for (const raw of body.assignments as AssignmentInput[]) {
        const componentId = raw.componentId;
        if (typeof componentId !== 'string' || !isUuid(componentId)) {
          return apiFailure('invalid_body', 'Every assignment needs a component.', 400);
        }

        if (parsed.some((row) => row.componentId === componentId)) {
          return apiFailure(
            'invalid_body',
            'The same component was sent twice.',
            400,
          );
        }

        // Membership of this school's catalogue is the tenant check: a
        // component id from another school is simply not in the map.
        const component = byId.get(componentId);
        if (component === undefined) {
          return apiFailure(
            'invalid_body',
            'One of the components does not belong to your school.',
            400,
          );
        }

        if (component.calculation === 'percent_of_basic') {
          const supplied = raw.percentBasisPoints;
          const points =
            supplied === undefined || supplied === null
              ? component.defaultPercentBasisPoints
              : Number(supplied);

          if (
            points !== null &&
            (!Number.isInteger(points) || points < 0 || points > 100_000)
          ) {
            return apiFailure(
              'invalid_body',
              `Enter a percentage between 0 and 1000 for ${component.name}.`,
              400,
            );
          }

          parsed.push({ componentId, amount: '0.00', percentBasisPoints: points });
          continue;
        }

        const paise = toPaise(raw.amount as string | number | null | undefined);
        if (paise < 0) {
          return apiFailure(
            'invalid_body',
            `${component.name} cannot be a negative amount.`,
            400,
          );
        }

        if (paise > MAX_COMPONENT_PAISE) {
          return apiFailure(
            'invalid_body',
            `${component.name} looks wrong — check the amount.`,
            400,
          );
        }

        parsed.push({
          componentId,
          amount: paiseToNumeric(paise),
          percentBasisPoints: null,
        });
      }

      // Deferred until `batch()` opens the transaction: a Drizzle builder is
      // bound to the session that created it, so these must be built on `tx`.
      const statements: ((tx: Tx) => PromiseLike<unknown>)[] = [
        (tx) =>
          tx
            .delete(staffSalaryStructures)
            .where(
              and(
                eq(staffSalaryStructures.locationId, auth.locationId),
                eq(staffSalaryStructures.staffId, staffId),
              ),
            ),
      ];

      for (const row of parsed) {
        statements.push((tx) =>
          tx.insert(staffSalaryStructures).values({
            locationId: auth.locationId,
            staffId,
            componentId: row.componentId,
            amount: row.amount,
            percentBasisPoints: row.percentBasisPoints,
          }),
        );
      }

      await batch(db, (tx) => statements.map((statement) => statement(tx)));

      return apiSuccess({
        structure: await getStaffSalaryStructure(auth.locationId, staffId),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'hr.write' },
);
