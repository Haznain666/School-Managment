import { and, eq, ne } from 'drizzle-orm';

import { payrollRunApprovals, payrollRuns } from '@/db/schema';
import { schoolUserIdForUid } from '@/lib/accounting-queries';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { getPayrollRun } from '@/lib/hr-queries';
import {
  listRunApprovals,
  resolveRunApprovers,
  writeApprovalRows,
} from '@/lib/payroll-approval';
import { isUuid, readOptionalString } from '@/lib/validation';

/**
 * /api/school/payroll/runs/[runId]/approvals
 *
 * GET  the slices of this run and where each stands
 * POST this head's decision on their own slice
 *
 * ── Two conditions on the POST, and both are enforced here ───────────────
 * The caller must hold `payroll.approve` — which `withSchoolAuth` settles
 * before the handler runs — **and** be one of this run's approvers, which only
 * this handler can know. A head at the same school who is not on this run has
 * the permission and no business signing it, and the `WHERE` below is what says
 * so: the update matches no rows and the response is a 403.
 *
 * ── The `WHERE status = 'pending'` is not belt and braces ────────────────
 * It is the whole race. Two clicks a hundred milliseconds apart both read a
 * pending row; one of them must not overwrite the other's decision, and a
 * rejection overwritten by an approval is a run that goes forward on a
 * signature somebody withdrew. Postgres settles it on one row under one lock.
 *
 * ── The run advances in the same chain, claimed ──────────────────────────
 * When the last pending slice turns `approved`, the run moves to `approved`
 * with `WHERE status = 'pending_approval' RETURNING id`. Two heads signing the
 * last two slices at the same instant both see zero remaining; exactly one of
 * them moves the run.
 *
 * ── A rejection returns the run to `draft` and clears every row ──────────
 * So the next submission is a clean sheet. Keeping the other heads' approvals
 * would carry a signature on numbers that were then edited, which is the one
 * thing a signature must never be.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ runId: string }> };

export const GET = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { runId } = await context.params;
      if (!isUuid(runId)) {
        return apiFailure('not_found', 'Payroll run not found.', 404);
      }

      const run = await getPayrollRun(auth.locationId, runId);
      if (run === null) {
        return apiFailure('not_found', 'Payroll run not found.', 404);
      }

      const [approvals, resolved, me] = await Promise.all([
        listRunApprovals(auth.locationId, runId),
        // Re-resolved rather than read from the rows, so the screen can say
        // "these three are covered by nobody" *before* the run is submitted —
        // which is the moment somebody can still fix the assignment.
        resolveRunApprovers(auth.locationId, runId),
        schoolUserIdForUid(auth.locationId, auth.uid),
      ]);

      return apiSuccess({
        approvals,
        uncovered: resolved.uncovered,
        noPrincipal: resolved.noPrincipal,
        /** Whether the person reading this is one of the run's approvers. */
        isApprover:
          me !== null &&
          approvals.some((row) => row.principalUserId === me && row.status === 'pending'),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'payroll.read' },
);

interface DecisionBody {
  decision?: unknown;
  note?: unknown;
}

export const POST = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { runId } = await context.params;
      if (!isUuid(runId)) {
        return apiFailure('not_found', 'Payroll run not found.', 404);
      }

      const run = await getPayrollRun(auth.locationId, runId);
      if (run === null) {
        return apiFailure('not_found', 'Payroll run not found.', 404);
      }

      if (run.status !== 'pending_approval') {
        return apiFailure(
          'invalid_state',
          `This run is ${run.status}, so there is nothing to sign.`,
          409,
        );
      }

      const body = await readJsonBody<DecisionBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      if (body.decision !== 'approved' && body.decision !== 'rejected') {
        return apiFailure('invalid_body', 'Approve it or reject it.', 400);
      }

      const decision = body.decision;
      const note = readOptionalString(body.note);

      // A rejection has to be able to say why. "The Principal rejected it" is
      // not information; the sentence that names the three days marked absent
      // is what somebody can act on.
      if (decision === 'rejected' && note === null) {
        return apiFailure(
          'invalid_body',
          'Say why you are sending this back — whoever fixes it needs to know what to fix.',
          400,
        );
      }

      const me = await schoolUserIdForUid(auth.locationId, auth.uid);
      if (me === null) {
        return apiFailure(
          'forbidden',
          'Your account is not a member of this school.',
          403,
        );
      }

      const claimed = await db
        .update(payrollRunApprovals)
        .set({ status: decision, note, decidedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(payrollRunApprovals.locationId, auth.locationId),
            eq(payrollRunApprovals.payrollRunId, runId),
            eq(payrollRunApprovals.principalUserId, me),
            // The race, and the entitlement, in one predicate. A head who is
            // not on this run matches no row; so does a second click.
            eq(payrollRunApprovals.status, 'pending'),
          ),
        )
        .returning({ id: payrollRunApprovals.id });

      if (claimed.length === 0) {
        return apiFailure(
          'forbidden',
          'This part of the run is not yours to sign, or it has already been signed.',
          403,
        );
      }

      /* ---------------------------------------------------------- rejected */
      if (decision === 'rejected') {
        await db.transaction(async (tx) => {
          const returned = await tx
            .update(payrollRuns)
            .set({ status: 'draft', updatedAt: new Date() })
            .where(
              and(
                eq(payrollRuns.id, runId),
                eq(payrollRuns.locationId, auth.locationId),
                // Claimed, so two heads rejecting at once produce one return.
                eq(payrollRuns.status, 'pending_approval'),
              ),
            )
            .returning({ id: payrollRuns.id });

          // Cleared only by whoever actually moved the run. Built on `tx`, so
          // the clearing and the status change commit together — a run back in
          // draft still carrying somebody's approval is a signature on a
          // document that is about to be edited.
          if (returned.length > 0) {
            await writeApprovalRows(tx, auth.locationId, runId, []);
          }
        });

        return apiSuccess({ decision, runStatus: 'draft' });
      }

      /* ---------------------------------------------------------- approved */
      const remaining = await db
        .select({ id: payrollRunApprovals.id })
        .from(payrollRunApprovals)
        .where(
          and(
            eq(payrollRunApprovals.locationId, auth.locationId),
            eq(payrollRunApprovals.payrollRunId, runId),
            ne(payrollRunApprovals.status, 'approved'),
          ),
        );

      if (remaining.length > 0) {
        return apiSuccess({
          decision,
          runStatus: 'pending_approval',
          remaining: remaining.length,
        });
      }

      const advanced = await db
        .update(payrollRuns)
        .set({ status: 'approved', approvedBy: me, approvedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(payrollRuns.id, runId),
            eq(payrollRuns.locationId, auth.locationId),
            // Claimed. Two heads signing the last two slices at the same
            // instant both read zero remaining; exactly one moves the run.
            eq(payrollRuns.status, 'pending_approval'),
          ),
        )
        .returning({ id: payrollRuns.id });

      return apiSuccess({
        decision,
        runStatus: advanced.length > 0 ? 'approved' : run.status,
        remaining: 0,
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'payroll.approve' },
);
