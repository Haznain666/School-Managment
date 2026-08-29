import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { withSchoolAuth } from '@/lib/api-auth';
import {
  getTransferCandidate,
  listTransfers,
  quoteProration,
  transferStudent,
  TransferError,
} from '@/lib/transfer-queries';
import { isUuid, readOptionalString } from '@/lib/validation';

/**
 * /api/school/transfers
 *
 * GET  the school's transfer history, or a quote for one student
 * POST carry out a transfer
 *
 * The quote is served by GET rather than computed in the browser because it
 * reads the student's open challans, and because the figure shown to the
 * operator before they press the button must be the figure that gets stored.
 * The route recomputes it at the moment of writing rather than trusting the
 * body — a quote fetched five minutes ago may have been overtaken by a payment.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);
      const studentProfileId = url.searchParams.get('studentProfileId');
      const effectiveDate = url.searchParams.get('effectiveDate');

      if (studentProfileId === null) {
        return apiSuccess({ transfers: await listTransfers(auth.locationId) });
      }

      if (!isUuid(studentProfileId)) {
        return apiFailure('not_found', 'Student not found.', 404);
      }

      const current = await getTransferCandidate(auth.locationId, studentProfileId);
      if (current === null) {
        return apiFailure(
          'not_found',
          'That student has no active enrollment to transfer.',
          404,
        );
      }

      // A branch-scoped admin cannot even look at a student on another campus.
      if (auth.branchId !== null && current.branchId !== auth.branchId) {
        return apiFailure('not_found', 'Student not found.', 404);
      }

      const quote =
        effectiveDate === null
          ? null
          : await quoteProration(auth.locationId, studentProfileId, effectiveDate);

      return apiSuccess({ current, quote });
    } catch (error) {
      if (error instanceof TransferError) {
        return apiFailure('invalid_body', error.message, error.status);
      }
      return handleApiError(error);
    }
  },
  { permission: 'students.transfer' },
);

interface TransferBody {
  studentProfileId?: unknown;
  toSectionId?: unknown;
  effectiveDate?: unknown;
  reason?: unknown;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<TransferBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const studentProfileId =
        typeof body.studentProfileId === 'string' ? body.studentProfileId : '';
      const toSectionId = typeof body.toSectionId === 'string' ? body.toSectionId : '';
      const effectiveDate =
        typeof body.effectiveDate === 'string' ? body.effectiveDate.trim() : '';

      if (!isUuid(studentProfileId) || !isUuid(toSectionId)) {
        return apiFailure('invalid_body', 'Choose a student and a class.', 400);
      }

      if (!ISO_DATE.test(effectiveDate) || Number.isNaN(Date.parse(effectiveDate))) {
        return apiFailure('invalid_body', 'Choose the date the move takes effect.', 400);
      }

      const current = await getTransferCandidate(auth.locationId, studentProfileId);
      if (current === null) {
        return apiFailure(
          'not_found',
          'That student has no active enrollment to transfer.',
          404,
        );
      }

      // Both ends are checked: a branch admin must not move a student out of
      // another campus, and must not move one *into* theirs from a campus they
      // do not run either. `students.transfer` is school_admin-only by default
      // for exactly this reason; the check is here in case it is granted.
      if (auth.branchId !== null && current.branchId !== auth.branchId) {
        return apiFailure('not_found', 'Student not found.', 404);
      }

      const result = await transferStudent({
        locationId: auth.locationId,
        actorUid: auth.uid,
        studentProfileId,
        toSectionId,
        effectiveDate,
        reason: readOptionalString(body.reason),
      });

      return apiSuccess({ result }, 201);
    } catch (error) {
      if (error instanceof TransferError) {
        return apiFailure('invalid_body', error.message, error.status);
      }
      return handleApiError(error);
    }
  },
  { permission: 'students.transfer' },
);
