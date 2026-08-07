
import { DEFAULT_LEAVE_TYPES, leaveTypes } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { batch, db } from '@/lib/drizzle';
import { listLeaveTypes } from '@/lib/hr-queries';
import { readBoolean, readOptionalString, readString } from '@/lib/validation';

/**
 * /api/school/hr/leave-types
 *
 * GET  the leave a school grants
 * POST create a head, or seed the usual four with `{ "seed": true }`
 *
 * `isPaid` is what payroll reads, and it is stored rather than inferred from
 * the name: a head called "Special Leave" tells nobody whether it docks pay,
 * and guessing wrong takes money off a teacher who was entitled to it.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);
      const activeOnly = url.searchParams.get('activeOnly') === 'true';

      return apiSuccess({
        leaveTypes: await listLeaveTypes(auth.locationId, { activeOnly }),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'hr.read' },
);

interface CreateLeaveTypeBody {
  seed?: unknown;
  name?: unknown;
  description?: unknown;
  annualQuotaDays?: unknown;
  isPaid?: unknown;
  sortOrder?: unknown;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<CreateLeaveTypeBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      // Seeding is idempotent for the same reason the fee-type seed is: each
      // insert conflicts on (location, name) and does nothing, so a school that
      // has already tuned its quotas keeps them.
      if (body.seed === true) {
        await batch(db, (tx) =>
          DEFAULT_LEAVE_TYPES.map((type) =>
            tx
              .insert(leaveTypes)
              .values({
                locationId: auth.locationId,
                name: type.name,
                description: type.description,
                annualQuotaDays: type.annualQuotaDays,
                isPaid: type.isPaid,
                sortOrder: type.sortOrder,
              })
              .onConflictDoNothing({
                target: [leaveTypes.locationId, leaveTypes.name],
              }),
          ),
        );

        return apiSuccess({ leaveTypes: await listLeaveTypes(auth.locationId) });
      }

      const name = readString(body.name);
      if (name === '' || name.length > 60) {
        return apiFailure(
          'invalid_body',
          'Enter a leave name of 60 characters or fewer.',
          400,
        );
      }

      const quota = Number(body.annualQuotaDays ?? 0);
      if (!Number.isInteger(quota) || quota < 0 || quota > 365) {
        return apiFailure(
          'invalid_body',
          'The annual quota must be a whole number of days between 0 and 365.',
          400,
        );
      }

      const sortOrderRaw = Number(body.sortOrder ?? 0);
      const sortOrder =
        Number.isInteger(sortOrderRaw) && sortOrderRaw >= 0 && sortOrderRaw <= 999
          ? sortOrderRaw
          : 0;

      const created = await db
        .insert(leaveTypes)
        .values({
          locationId: auth.locationId,
          name,
          description: readOptionalString(body.description),
          annualQuotaDays: quota,
          isPaid: readBoolean(body.isPaid, true),
          sortOrder,
        })
        .onConflictDoNothing({ target: [leaveTypes.locationId, leaveTypes.name] })
        .returning({ id: leaveTypes.id });

      if (created[0] === undefined) {
        return apiFailure(
          'duplicate',
          `Your school already has a leave type called "${name}".`,
          409,
        );
      }

      return apiSuccess({ leaveTypeId: created[0].id }, 201);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'hr.write' },
);
