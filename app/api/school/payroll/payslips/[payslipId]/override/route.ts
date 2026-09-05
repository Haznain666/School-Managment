import { and, eq, sql } from 'drizzle-orm';

import { payrollRuns, payslips } from '@/db/schema';
import { schoolUserIdForUid } from '@/lib/accounting-queries';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { getPayslipDetail } from '@/lib/hr-queries';
import { paiseToNumeric, toPaise } from '@/lib/money';
import { resolveRunApprovers } from '@/lib/payroll-approval';
import { hasPermission } from '@/lib/permission-queries';
import { isUuid, readOptionalString } from '@/lib/validation';

/**
 * /api/school/payroll/payslips/[payslipId]/override
 *
 * PATCH replace a payslip's loss of pay, with a reason.
 *
 * ── Why this is its own route and not a field on the payslip PATCH ───────
 * `withSchoolAuth` takes exactly one permission, and this action has two
 * holders: `payroll.write` while the run is a draft, and a **covering
 * principal** holding `payroll.approve` while it is `pending_approval`. The
 * payslip PATCH beside it is `payroll.write`, so folding this in would either
 * lock every head out of the one action Part C exists for, or hand HR's key to
 * whoever holds a head's.
 *
 * So the gate here is `payroll.read` — the floor for touching payroll at all —
 * and the real check is below, where the run's status and the caller's coverage
 * are both known. That is deliberate and it is written down rather than
 * discovered: a route gated more loosely than it acts is only safe when the
 * acting check is in the same file as the gate.
 *
 * ── The override is a replacement, and the original is kept ──────────────
 * `loss_of_pay_override` is *the* loss of pay for this payslip, not a delta.
 * `0.00` waives the deduction, which is the common case. `loss_of_pay_amount`
 * is never overwritten: a teacher asking why they were paid more than the
 * register implies is owed both numbers.
 *
 * ── The reason is required, and it is required because of a conversation ─
 * A waived deduction with no reason is a figure nobody can defend six months
 * later, when the person who waived it has left and the auditor is asking.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ payslipId: string }> };

interface OverrideBody {
  /** The replacement loss-of-pay amount in rupees. `null` clears the override. */
  lossOfPayOverride?: unknown;
  overrideReason?: unknown;
}

export const PATCH = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { payslipId } = await context.params;
      if (!isUuid(payslipId)) {
        return apiFailure('not_found', 'Payslip not found.', 404);
      }

      const existing = await getPayslipDetail(auth.locationId, payslipId);
      if (existing === null) {
        return apiFailure('not_found', 'Payslip not found.', 404);
      }

      // The existing rule, and the right one. An approved or paid run is the
      // school's record of what it owes or what left the bank, and a figure
      // that moved after a payslip was handed over is a payslip nobody trusts.
      if (existing.runStatus !== 'draft' && existing.runStatus !== 'pending_approval') {
        return apiFailure(
          'invalid_state',
          `This run is ${existing.runStatus}, so its figures can no longer be changed.`,
          409,
        );
      }

      const canWrite = await hasPermission(auth.locationId, auth.role, 'payroll.write');
      const canApprove = await hasPermission(
        auth.locationId,
        auth.role,
        'payroll.approve',
      );

      if (existing.runStatus === 'draft' && !canWrite) {
        return apiFailure(
          'forbidden',
          'Only whoever runs the payroll may change a draft.',
          403,
        );
      }

      if (existing.runStatus === 'pending_approval') {
        if (!canApprove) {
          return apiFailure(
            'forbidden',
            'Only a head approving this run may change a deduction on it.',
            403,
          );
        }

        /*
         * And they must cover *this* payslip.
         *
         * `payroll.approve` says a person may sign for the staff they are
         * responsible for; it does not say which staff those are. Without this
         * check a Junior School head could waive a deduction on a Senior School
         * teacher's slip — which is the exact boundary the whole of Part C
         * exists to draw, undone by the one action that changes a number.
         *
         * `payroll.write` skips it: HR is answerable for the whole run.
         */
        if (!canWrite) {
          const me = await schoolUserIdForUid(auth.locationId, auth.uid);
          const resolved = await resolveRunApprovers(
            auth.locationId,
            existing.payrollRunId,
          );

          const mine = resolved.approvers.find((row) => row.principalUserId === me);

          if (mine === undefined || !mine.payslipIds.includes(payslipId)) {
            return apiFailure(
              'forbidden',
              'That payslip is not one of the ones you are approving.',
              403,
            );
          }
        }
      }

      const body = await readJsonBody<OverrideBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const clearing = body.lossOfPayOverride === null;
      const reason = readOptionalString(body.overrideReason);

      let overridePaise = 0;

      if (!clearing) {
        const amount = Number(body.lossOfPayOverride);
        if (!Number.isFinite(amount) || amount < 0) {
          return apiFailure(
            'invalid_body',
            'Enter the loss of pay this payslip should carry, in rupees. Zero waives it.',
            400,
          );
        }

        // Money is integer paise throughout — `lib/money.ts` — so the rupee
        // figure from the browser is converted once, here, and never compared
        // as a float.
        overridePaise = toPaise(amount);

        if (overridePaise > toPaise(existing.grossEarnings)) {
          return apiFailure(
            'invalid_body',
            'A deduction cannot be larger than the gross pay it comes out of.',
            400,
          );
        }

        if (reason === null) {
          return apiFailure(
            'invalid_body',
            'Say why. A waived deduction with no reason is a figure nobody can defend.',
            400,
          );
        }
      }

      /*
       * The recomputation, in one transaction with the run's three totals.
       *
       * `net_payable` is `gross − deductions − (override ?? loss of pay)`,
       * floored at zero — `payslips_net_payable_check` still holds and an
       * override cannot pay somebody a negative salary.
       *
       * The run's totals move by the *difference* rather than being re-summed:
       * re-summing would need every payslip in the run read back inside the
       * transaction, and the difference is exact because only one row changed.
       */
      const originalPaise = toPaise(existing.lossOfPayAmount);
      const previousPaise =
        existing.lossOfPayOverride === null
          ? originalPaise
          : toPaise(existing.lossOfPayOverride);
      const nextPaise = clearing ? originalPaise : overridePaise;

      const netPaise = Math.max(
        0,
        toPaise(existing.grossEarnings) - toPaise(existing.totalDeductions) - nextPaise,
      );

      const deductionDelta = nextPaise - previousPaise;
      const netDelta = netPaise - toPaise(existing.netPayable);

      const actorId = await schoolUserIdForUid(auth.locationId, auth.uid);

      await db.transaction(async (tx) => {
        await tx
          .update(payslips)
          .set({
            lossOfPayOverride: clearing ? null : paiseToNumeric(nextPaise),
            overrideReason: clearing ? null : reason,
            overriddenBy: clearing ? null : actorId,
            overriddenAt: clearing ? null : new Date(),
            netPayable: paiseToNumeric(netPaise),
            updatedAt: new Date(),
          })
          .where(
            and(eq(payslips.id, payslipId), eq(payslips.locationId, auth.locationId)),
          );

        await tx
          .update(payrollRuns)
          .set({
            // In SQL rather than from a value read a moment ago: two heads
            // overriding two payslips in the same instant would otherwise each
            // write `read + their own delta`, and the second would erase the
            // first from the run's totals.
            deductionTotal: sql`${payrollRuns.deductionTotal} + ${paiseToNumeric(deductionDelta)}`,
            netTotal: sql`${payrollRuns.netTotal} + ${paiseToNumeric(netDelta)}`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(payrollRuns.id, existing.payrollRunId),
              eq(payrollRuns.locationId, auth.locationId),
            ),
          );
      });

      return apiSuccess({
        payslip: await getPayslipDetail(auth.locationId, payslipId),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'payroll.read' },
);
