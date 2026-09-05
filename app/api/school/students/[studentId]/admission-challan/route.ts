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
 * ── Costs `fees.admission`, and that is Sprint 28's whole point ─────────
 * It cost `fees.write` until then, which is "set prices, raise vouchers and
 * take payments" — a key `branch_admin`, `principal` and `vice_principal`
 * deliberately do not hold, for the same reason `accounting.settle` is kept
 * away from the person who takes the cash. So the three roles that admit
 * children were the three that could not bill one: the panel offered them no
 * button, the enrollment stayed `outstanding`, and a voucher register cannot
 * list a child who has no voucher. Askari's Student 50 was admitted by a
 * Principal into a grade priced at PKR 35,000 and was never billed a rupee.
 *
 * `fees.admission` is the narrowest key that repairs that. Everything it
 * raises is resolved here — one child, one head, one amount out of the fee
 * structure — so holding it grants nothing over the price list and nothing
 * over taking money, which is exactly why it is not `fees.write`.
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
  { permission: 'fees.admission' },
);
