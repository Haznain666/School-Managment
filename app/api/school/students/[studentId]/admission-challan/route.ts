import { getStudentDetail } from '@/lib/admissions-queries';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { ChallanGenerationError, generateAdmissionChallan } from '@/lib/fee-challans';
import { isUuid } from '@/lib/validation';

/**
 * POST /api/school/students/[studentId]/admission-challan
 *
 * Raises the voucher for this student's admission fee.
 *
 * ── Why it is its own endpoint ───────────────────────────────────────────
 * The generation screen bills a *period* for a *grade*: it asks for a month and
 * a year and works down a section. An admission fee is neither — it is one
 * charge, for one child, on the day they are admitted, and the clerk raising it
 * is standing on that child's profile looking at the panel that says it has not
 * been billed. Sending them to the fee module to find a screen that cannot in
 * fact raise a one-time charge is how the fee went unbilled at LGS.
 *
 * ── Everything trusted comes from the session ────────────────────────────
 * The tenant is `auth.locationId` and never the body; the amount, the head, the
 * grade and the year are all resolved server-side by `resolveAdmissionFee`.
 * There is nothing in the request but the student in the path, which is
 * deliberate: a request body carrying an amount is a request body that can be
 * edited by whoever is holding it.
 *
 * Branch-scoped like every other route on a student — a branch admin may raise
 * a voucher only inside their own campus.
 *
 * Costs `fees.write`. Raising a demand for money is a money action.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ studentId: string }> };

export const POST = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { studentId } = await context.params;
      if (!isUuid(studentId)) return apiFailure('not_found', 'Student not found.', 404);

      const student = await getStudentDetail(auth.locationId, studentId);
      if (student === null) return apiFailure('not_found', 'Student not found.', 404);

      if (auth.branchId !== null && student.branchId !== auth.branchId) {
        return apiFailure('not_found', 'Student not found.', 404);
      }

      const challan = await generateAdmissionChallan(db, {
        locationId: auth.locationId,
        studentProfileId: studentId,
        actorUid: auth.uid,
      });

      return apiSuccess({ challan }, 201);
    } catch (error) {
      // The generator's refusals are all things an administrator can act on —
      // no price set, no fee head, already billed — so they are answered with
      // their own message and status rather than flattened into a 500 that
      // says nothing about which of the three it was.
      if (error instanceof ChallanGenerationError) {
        return apiFailure(error.code, error.message, error.status);
      }

      return handleApiError(error);
    }
  },
  { permission: 'fees.write' },
);
