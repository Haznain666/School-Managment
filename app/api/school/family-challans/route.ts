import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { withSchoolAuth } from '@/lib/api-auth';
import {
  createFamilyChallan,
  familyOpenVouchers,
  listFamilyCandidates,
  listFamilyChallans,
  FamilyChallanError,
} from '@/lib/family-challans';
import { isUuid } from '@/lib/validation';

/**
 * /api/school/family-challans
 *
 * GET  issued vouchers; with ?month=&year= the families that could take one;
 *      with ?guardianId= as well, that one family's open vouchers for the month
 * POST issue a voucher over a family's open challans
 *
 * The candidate list and the issuing both read the challans server-side. The
 * browser never says which challans belong to a family — it could be holding a
 * group drawn before a payment came in, and folding a paid challan into a
 * voucher would demand the money twice.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);
      const monthRaw = url.searchParams.get('month');
      const yearRaw = url.searchParams.get('year');

      if (monthRaw === null || yearRaw === null) {
        return apiSuccess({ challans: await listFamilyChallans(auth.locationId) });
      }

      const month = Number.parseInt(monthRaw, 10);
      const year = Number.parseInt(yearRaw, 10);

      if (!Number.isInteger(month) || month < 1 || month > 12) {
        return apiFailure('invalid_body', 'Choose a billing month.', 400);
      }
      if (!Number.isInteger(year) || year < 2000 || year > 2100) {
        return apiFailure('invalid_body', 'Choose a billing year.', 400);
      }

      /*
       * Step 3 of the wizard: one family's open vouchers for the chosen month.
       *
       * Re-read here rather than carried down from the search, for the same
       * reason `createFamilyChallan` re-reads its members — the browser may be
       * holding a list drawn before a payment came in.
       */
      const guardianId = url.searchParams.get('guardianId');
      if (guardianId !== null) {
        if (!isUuid(guardianId)) {
          return apiFailure('invalid_query', 'That family is not at this school.', 400);
        }

        return apiSuccess({
          vouchers: await familyOpenVouchers(auth.locationId, guardianId, month, year),
        });
      }

      return apiSuccess({
        families: await listFamilyCandidates(auth.locationId, month, year),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'fees.read' },
);

interface CreateBody {
  guardianId?: unknown;
  challanIds?: unknown;
  dueDate?: unknown;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<CreateBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const guardianId = typeof body.guardianId === 'string' ? body.guardianId : '';
      if (!isUuid(guardianId)) {
        return apiFailure('invalid_body', 'Choose a family.', 400);
      }

      const challanIds = Array.isArray(body.challanIds)
        ? [...new Set(body.challanIds.filter((id): id is string => isUuid(id)))]
        : [];

      const dueDate = typeof body.dueDate === 'string' ? body.dueDate.trim() : '';
      if (!ISO_DATE.test(dueDate) || Number.isNaN(Date.parse(dueDate))) {
        return apiFailure('invalid_body', 'Choose a due date for the voucher.', 400);
      }

      const result = await createFamilyChallan({
        locationId: auth.locationId,
        actorUid: auth.uid,
        guardianId,
        challanIds,
        dueDate,
      });

      return apiSuccess({ result }, 201);
    } catch (error) {
      if (error instanceof FamilyChallanError) {
        return apiFailure('invalid_body', error.message, error.status);
      }
      return handleApiError(error);
    }
  },
  { permission: 'fees.write' },
);
