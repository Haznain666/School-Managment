import { ChallanNumberError } from '@/lib/challan-number';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import {
  bulkGenerateChallans,
  ChallanGenerationError,
  listBulkCandidates,
} from '@/lib/fee-challans';
import { isUuid } from '@/lib/validation';

/**
 * /api/school/fees/challans/bulk-generate
 *
 * GET  who a run would bill, and who it would skip — the preview
 * POST raise a challan for every active student in a grade or section
 *
 * Re-running is safe. A student who already holds a challan for the period is
 * skipped, not billed again, which is what lets a school repeat a run that was
 * interrupted halfway through a grade of two hundred.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface BulkBody {
  gradeId?: unknown;
  sectionId?: unknown;
  billingMonth?: unknown;
  billingYear?: unknown;
  academicYearId?: unknown;
  dueDate?: unknown;
}

function isDateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Shared validation for both verbs; returns the parsed request or a message. */
function parseParams(source: {
  gradeId: unknown;
  sectionId: unknown;
  academicYearId: unknown;
  billingMonth: unknown;
  billingYear: unknown;
}):
  | {
      gradeId: string;
      sectionId: string | undefined;
      academicYearId: string;
      billingMonth: number;
      billingYear: number;
    }
  | string {
  if (!isUuid(source.gradeId)) return 'Select a grade.';
  if (!isUuid(source.academicYearId)) return 'Select an academic year.';

  const billingMonth = Number(source.billingMonth);
  const billingYear = Number(source.billingYear);

  if (!Number.isInteger(billingMonth) || billingMonth < 1 || billingMonth > 12) {
    return 'Choose a billing month.';
  }
  if (!Number.isInteger(billingYear) || billingYear < 2000 || billingYear > 2100) {
    return 'Choose a billing year.';
  }

  return {
    gradeId: source.gradeId,
    sectionId: isUuid(source.sectionId) ? source.sectionId : undefined,
    academicYearId: source.academicYearId,
    billingMonth,
    billingYear,
  };
}

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);

      const parsed = parseParams({
        gradeId: url.searchParams.get('gradeId'),
        sectionId: url.searchParams.get('sectionId'),
        academicYearId: url.searchParams.get('academicYearId'),
        billingMonth: url.searchParams.get('billingMonth'),
        billingYear: url.searchParams.get('billingYear'),
      });

      if (typeof parsed === 'string') {
        return apiFailure('invalid_query', parsed, 400);
      }

      const candidates = await listBulkCandidates(db, {
        locationId: auth.locationId,
        ...parsed,
      });

      return apiSuccess({
        candidates,
        toGenerate: candidates.filter((row) => row.existingChallanNumber === null).length,
        alreadyBilled: candidates.filter((row) => row.existingChallanNumber !== null)
          .length,
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'fees.read' },
);

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<BulkBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const parsed = parseParams({
        gradeId: body.gradeId,
        sectionId: body.sectionId,
        academicYearId: body.academicYearId,
        billingMonth: body.billingMonth,
        billingYear: body.billingYear,
      });

      if (typeof parsed === 'string') {
        return apiFailure('invalid_body', parsed, 400);
      }

      if (body.dueDate !== undefined && body.dueDate !== null && body.dueDate !== '') {
        if (!isDateOnly(body.dueDate)) {
          return apiFailure('invalid_body', 'Enter a valid due date.', 400);
        }
      }

      const result = await bulkGenerateChallans(db, {
        // Tenant comes from the verified session, never from the body.
        locationId: auth.locationId,
        actorUid: auth.uid,
        ...parsed,
        dueDate: isDateOnly(body.dueDate) ? body.dueDate : undefined,
      });

      return apiSuccess(result, 201);
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
  { permission: 'fees.write' },
);
