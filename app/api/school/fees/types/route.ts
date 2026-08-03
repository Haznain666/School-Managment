import { feeTypes, isFeeCategory } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { listFeeTypes } from '@/lib/fee-queries';
import { readOptionalString, readString } from '@/lib/validation';

/**
 * /api/school/fees/types
 *
 * GET  the school's fee heads
 * POST create one
 *
 * The category is not cosmetic: `monthly` heads are what a monthly challan run
 * bills, and getting it wrong charges a parent their admission fee every month.
 * It is therefore validated against the enum rather than accepted as free text.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);
      const activeOnly = url.searchParams.get('activeOnly') === 'true';

      return apiSuccess({
        feeTypes: await listFeeTypes(auth.locationId, { activeOnly }),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'fees.read' },
);

interface CreateFeeTypeBody {
  name?: unknown;
  description?: unknown;
  feeCategory?: unknown;
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
        return apiFailure(
          'invalid_body',
          'Enter a fee name of 80 characters or fewer.',
          400,
        );
      }

      if (!isFeeCategory(body.feeCategory)) {
        return apiFailure(
          'invalid_body',
          'Choose whether this fee is monthly, one time or annual.',
          400,
        );
      }

      const sortOrderRaw = Number(body.sortOrder ?? 0);
      const sortOrder =
        Number.isInteger(sortOrderRaw) && sortOrderRaw >= 0 && sortOrderRaw <= 999
          ? sortOrderRaw
          : 0;

      const created = await db
        .insert(feeTypes)
        .values({
          // Tenant comes from the verified session, never from the body.
          locationId: auth.locationId,
          name,
          description: readOptionalString(body.description),
          feeCategory: body.feeCategory,
          sortOrder,
        })
        .onConflictDoNothing({ target: [feeTypes.locationId, feeTypes.name] })
        .returning({ id: feeTypes.id });

      if (created[0] === undefined) {
        return apiFailure(
          'duplicate',
          `Your school already has a fee called "${name}".`,
          409,
        );
      }

      return apiSuccess({ feeTypeId: created[0].id }, 201);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'fees.write' },
);
