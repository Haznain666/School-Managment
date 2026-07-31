import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import {
  ChallanGenerationError,
  generateChallan,
} from '@/lib/challan-generation';
import { ChallanNumberError } from '@/lib/challan-number';
import { db } from '@/lib/drizzle';
import { getChallanDetail, listChallans } from '@/lib/fee-queries';
import { FEE_READ_ROLES, FEE_WRITE_ROLES } from '@/lib/fee-roles';
import { isFeeCategory, type FeeCategory } from '@/db/schema';
import { isUuid, readOptionalString, readString } from '@/lib/validation';

/**
 * /api/school/fees/challans
 *
 * GET  the challan register, filtered and paginated
 * POST raise one challan for one student
 *
 * Generation is shared with the bulk route (`lib/challan-generation.ts`), so a
 * challan raised singly is indistinguishable from one raised in a run of four
 * hundred — same numbering, same concession handling, same atomicity.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function readMonth(value: string | null): number | undefined {
  if (value === null || value === '') return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 12 ? parsed : undefined;
}

function readYear(value: string | null): number | undefined {
  if (value === null || value === '') return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100
    ? parsed
    : undefined;
}

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);

      const pageRaw = Number.parseInt(url.searchParams.get('page') ?? '1', 10);
      const limitRaw = Number.parseInt(url.searchParams.get('limit') ?? '20', 10);

      const result = await listChallans(auth.locationId, {
        status: url.searchParams.get('status') ?? undefined,
        gradeId: url.searchParams.get('gradeId') ?? undefined,
        sectionId: url.searchParams.get('sectionId') ?? undefined,
        academicYearId: url.searchParams.get('academicYearId') ?? undefined,
        studentProfileId: url.searchParams.get('studentProfileId') ?? undefined,
        billingMonth: readMonth(url.searchParams.get('billingMonth')),
        billingYear: readYear(url.searchParams.get('billingYear')),
        search: url.searchParams.get('search') ?? undefined,
        page: Number.isFinite(pageRaw) ? pageRaw : 1,
        limit: Number.isFinite(limitRaw) ? limitRaw : 20,
      });

      return apiSuccess(result);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: FEE_READ_ROLES },
);

interface CreateChallanBody {
  studentProfileId?: unknown;
  billingMonth?: unknown;
  billingYear?: unknown;
  academicYearId?: unknown;
  dueDate?: unknown;
  categories?: unknown;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<CreateChallanBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const studentProfileId = readString(body.studentProfileId);
      const academicYearId = readString(body.academicYearId);

      if (!isUuid(studentProfileId)) {
        return apiFailure('invalid_body', 'Select a student.', 400);
      }
      if (!isUuid(academicYearId)) {
        return apiFailure('invalid_body', 'Select an academic year.', 400);
      }

      const billingMonth = Number(body.billingMonth);
      const billingYear = Number(body.billingYear);

      const dueDate = readOptionalString(body.dueDate);
      if (
        dueDate !== null &&
        (!ISO_DATE.test(dueDate) || Number.isNaN(Date.parse(dueDate)))
      ) {
        return apiFailure('invalid_body', 'Enter a valid due date.', 400);
      }

      // Which fee heads to bill. Defaults to monthly only — billing the annual
      // charges every month would overcharge every family in the school.
      let categories: FeeCategory[] | undefined;
      if (Array.isArray(body.categories)) {
        const parsed = body.categories.filter(isFeeCategory);
        if (parsed.length !== body.categories.length) {
          return apiFailure('invalid_body', 'One of the fee categories is not valid.', 400);
        }
        categories = parsed;
      }

      const challan = await generateChallan(db, {
        // Tenant comes from the verified session, never from the body.
        locationId: auth.locationId,
        actorUid: auth.uid,
        studentProfileId,
        billingMonth,
        billingYear,
        academicYearId,
        dueDate,
        ...(categories === undefined ? {} : { categories }),
      });

      return apiSuccess(
        { challan: await getChallanDetail(auth.locationId, challan.challanId) },
        201,
      );
    } catch (error) {
      if (error instanceof ChallanGenerationError) {
        return apiFailure(error.code, error.message, error.status);
      }
      if (error instanceof ChallanNumberError) {
        return apiFailure('challan_number_failed', error.message, 409);
      }
      return handleApiError(error);
    }
  },
  { allowedRoles: FEE_WRITE_ROLES },
);
