import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { ChallanGenerationError, previewChallan } from '@/lib/fee-challans';
import { isUuid } from '@/lib/validation';

/**
 * GET /api/school/fees/challans/preview
 *
 * What a challan *would* say, without writing anything.
 *
 * The generation screen renders this so a bursar can see the line items and the
 * concessions before committing. It is a courtesy and nothing more — POST
 * recomputes everything from the same code rather than trusting a total that
 * came back from a browser.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isDateOnly(value: string | null): value is string {
  if (value === null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);

      const studentProfileId = url.searchParams.get('studentProfileId') ?? '';
      const academicYearId = url.searchParams.get('academicYearId') ?? '';

      if (!isUuid(studentProfileId)) {
        return apiFailure('invalid_query', 'Select a student.', 400);
      }
      if (!isUuid(academicYearId)) {
        return apiFailure('invalid_query', 'Select an academic year.', 400);
      }

      const billingMonth = Number(url.searchParams.get('billingMonth'));
      const billingYear = Number(url.searchParams.get('billingYear'));

      if (!Number.isInteger(billingMonth) || billingMonth < 1 || billingMonth > 12) {
        return apiFailure('invalid_query', 'Choose a billing month.', 400);
      }
      if (!Number.isInteger(billingYear) || billingYear < 2000 || billingYear > 2100) {
        return apiFailure('invalid_query', 'Choose a billing year.', 400);
      }

      const dueDateParam = url.searchParams.get('dueDate');

      const preview = await previewChallan(db, {
        locationId: auth.locationId,
        studentProfileId,
        academicYearId,
        billingMonth,
        billingYear,
        dueDate: isDateOnly(dueDateParam) ? dueDateParam : undefined,
      });

      return apiSuccess({ preview });
    } catch (error) {
      if (error instanceof ChallanGenerationError) {
        return apiFailure(error.code, error.message, error.status);
      }
      return handleApiError(error);
    }
  },
  { permission: 'fees.read' },
);
