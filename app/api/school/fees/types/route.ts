import { feeTypes, isFeeCategory } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { listFeeTypes } from '@/lib/fee-queries';
import { FEE_READ_ROLES, FEE_WRITE_ROLES } from '@/lib/fee-roles';
import { readOptionalString, readString } from '@/lib/validation';

/**
 * /api/school/fees/types — the heads a school bills under.
 *
 * GET  every fee head, in the order they print on a challan
 * POST create one
 *
 * Per school, not platform-wide: one school's "Annual Charges" is another's
 * "Development Fund".
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);
      const activeOnly = url.searchParams.get('activeOnly') === 'true';

      return apiSuccess({ feeTypes: await listFeeTypes(auth.locationId, { activeOnly }) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: FEE_READ_ROLES },
);

interface CreateFeeTypeBody {
  name?: unknown;
  feeCategory?: unknown;
  description?: unknown;
  sortOrder?: unknown;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<CreateFeeTypeBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const name = readString(body.name);
      if (name === '' || name.length > 80) {
        return apiFailure('invalid_body', 'Enter a name of 80 characters or fewer.', 400);
      }

      if (!isFeeCategory(body.feeCategory)) {
        return apiFailure(
          'invalid_body',
          'Choose whether this is charged monthly, once, or annually.',
          400,
        );
      }

      const sortOrderRaw = Number(body.sortOrder);
      const sortOrder = Number.isInteger(sortOrderRaw) ? sortOrderRaw : 0;

      const inserted = await db
        .insert(feeTypes)
        .values({
          // Tenant comes from the verified session, never from the body.
          locationId: auth.locationId,
          name,
          description: readOptionalString(body.description),
          feeCategory: body.feeCategory,
          sortOrder,
        })
        // Unique on (location_id, name).
        .onConflictDoNothing()
        .returning({ id: feeTypes.id });

      if (inserted[0] === undefined) {
        return apiFailure(
          'already_exists',
          `This school already has a fee head called ${name}.`,
          409,
        );
      }

      return apiSuccess({ feeTypes: await listFeeTypes(auth.locationId) }, 201);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: FEE_WRITE_ROLES },
);
