import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { ChallanGenerationError, generateChallan } from '@/lib/fee-challans';
import { listChallans } from '@/lib/fee-queries';
import { ChallanNumberError } from '@/lib/challan-number';
import { isUuid, readOptionalString } from '@/lib/validation';

/**
 * /api/school/fees/challans
 *
 * GET  the challan register, filtered and paginated
 * POST raise one challan for one student
 *
 * ── On the shape of POST ─────────────────────────────────────────────────
 * The body names *who* and *when*, never *how much*. Amounts are recomputed
 * server-side from the price list and the student's concessions, because a
 * total that arrived from a browser is a total anyone could have edited.
 *
 * The header and its line items are written in one transaction through
 * `batch()` — see `lib/fee-challans.ts` — and the challan number is reserved
 * atomically before either lands.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Reads an integer query parameter, or undefined when absent or malformed. */
function readIntParam(value: string | null): number | undefined {
  if (value === null || value === '') return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);

      const result = await listChallans(auth.locationId, {
        academicYearId: url.searchParams.get('academicYearId') ?? undefined,
        billingMonth: readIntParam(url.searchParams.get('billingMonth')),
        billingYear: readIntParam(url.searchParams.get('billingYear')),
        gradeId: url.searchParams.get('gradeId') ?? undefined,
        sectionId: url.searchParams.get('sectionId') ?? undefined,
        status: url.searchParams.get('status') ?? undefined,
        search: url.searchParams.get('search') ?? undefined,
        studentProfileId: url.searchParams.get('studentProfileId') ?? undefined,
        page: readIntParam(url.searchParams.get('page')) ?? 1,
        limit: readIntParam(url.searchParams.get('limit')) ?? 20,
      });

      return apiSuccess(result);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'fees.read' },
);

interface CreateChallanBody {
  studentProfileId?: unknown;
  academicYearId?: unknown;
  billingMonth?: unknown;
  billingYear?: unknown;
  dueDate?: unknown;
  notes?: unknown;
}

function isDateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<CreateChallanBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const { studentProfileId, academicYearId } = body;

      if (!isUuid(studentProfileId)) {
        return apiFailure('invalid_body', 'Select a student.', 400);
      }
      if (!isUuid(academicYearId)) {
        return apiFailure('invalid_body', 'Select an academic year.', 400);
      }

      const billingMonth = Number(body.billingMonth);
      const billingYear = Number(body.billingYear);

      if (!Number.isInteger(billingMonth) || billingMonth < 1 || billingMonth > 12) {
        return apiFailure('invalid_body', 'Choose a billing month.', 400);
      }
      if (!Number.isInteger(billingYear) || billingYear < 2000 || billingYear > 2100) {
        return apiFailure('invalid_body', 'Choose a billing year.', 400);
      }

      if (body.dueDate !== undefined && body.dueDate !== null && body.dueDate !== '') {
        if (!isDateOnly(body.dueDate)) {
          return apiFailure('invalid_body', 'Enter a valid due date.', 400);
        }
      }

      const challan = await generateChallan(db, {
        // Tenant comes from the verified session, never from the body.
        locationId: auth.locationId,
        actorUid: auth.uid,
        studentProfileId,
        academicYearId,
        billingMonth,
        billingYear,
        dueDate: isDateOnly(body.dueDate) ? body.dueDate : undefined,
        notes: readOptionalString(body.notes),
      });

      return apiSuccess({ challan }, 201);
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
