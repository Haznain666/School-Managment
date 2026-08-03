import { and, eq } from 'drizzle-orm';

import {
  canTransitionRun,
  isPayrollRunStatus,
  payrollRuns,
  payslips,
  schoolUsers,
} from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { getPayrollRun, listPayslipsForRun } from '@/lib/hr-queries';
import {
  generatePayrollRun,
  PayrollGenerationError,
} from '@/lib/payroll-generation';
import { PayslipNumberError } from '@/lib/payslip-number';
import { isUuid, readOptionalString } from '@/lib/validation';

/**
 * /api/school/payroll/runs/[runId]
 *
 * GET   one run and its payslips
 * PATCH move it through draft -> approved -> paid, or regenerate a draft
 *
 * ── On the state machine ─────────────────────────────────────────────────
 * `canTransitionRun` is the only thing that decides whether a move is legal,
 * and the current status is re-checked in the SQL `WHERE` so two administrators
 * approving at the same moment cannot both write — the second matches no rows.
 *
 * Regeneration is refused on anything but a draft. Once a run is approved it is
 * the school's record of what it owes its staff; recomputing it silently is how
 * a teacher ends up paid a figure nobody authorised. And marking a run `paid`
 * marks its unpaid payslips paid in the same request, because a run that says
 * paid over a list of payslips that say unpaid is a reconciliation problem
 * waiting to be found at the bank.
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

      return apiSuccess({
        run,
        payslips: await listPayslipsForRun(auth.locationId, runId),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'payroll.read' },
);

interface UpdateRunBody {
  status?: unknown;
  notes?: unknown;
  regenerate?: unknown;
  workingDays?: unknown;
}

export const PATCH = withSchoolAuth<RouteContext>(
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

      const body = await readJsonBody<UpdateRunBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      // ---- Regeneration ---------------------------------------------------
      if (body.regenerate === true) {
        if (run.status !== 'draft') {
          return apiFailure(
            'invalid_state',
            `This run is ${run.status} and can no longer be recomputed.`,
            409,
          );
        }

        const workingDaysRaw = body.workingDays;
        const workingDays =
          workingDaysRaw === undefined || workingDaysRaw === null
            ? run.workingDays
            : Number(workingDaysRaw);

        if (!Number.isInteger(workingDays) || workingDays < 1 || workingDays > 31) {
          return apiFailure(
            'invalid_body',
            'The working days must be a whole number between 1 and 31.',
            400,
          );
        }

        if (workingDays !== run.workingDays) {
          await db
            .update(payrollRuns)
            .set({ workingDays, updatedAt: new Date() })
            .where(
              and(eq(payrollRuns.id, runId), eq(payrollRuns.locationId, auth.locationId)),
            );
        }

        const result = await generatePayrollRun({
          locationId: auth.locationId,
          runId,
          payrollMonth: run.payrollMonth,
          payrollYear: run.payrollYear,
          workingDays,
          branchId: run.branchId,
        });

        return apiSuccess({
          run: await getPayrollRun(auth.locationId, runId),
          staffCount: result.staffCount,
          skipped: result.skipped,
        });
      }

      // ---- Status and notes -----------------------------------------------
      const updates: Partial<typeof payrollRuns.$inferInsert> = {};

      if (body.notes !== undefined) {
        updates.notes = readOptionalString(body.notes);
      }

      let nextStatus: typeof run.status | null = null;

      if (body.status !== undefined) {
        if (!isPayrollRunStatus(body.status)) {
          return apiFailure('invalid_body', 'Choose a valid status.', 400);
        }

        if (body.status !== run.status) {
          if (!canTransitionRun(run.status, body.status)) {
            return apiFailure(
              'invalid_state',
              `A ${run.status} run cannot become ${body.status}.`,
              409,
            );
          }

          if (body.status === 'approved' && run.staffCount === 0) {
            return apiFailure(
              'invalid_state',
              'This run has no payslips to approve.',
              409,
            );
          }

          nextStatus = body.status;
          updates.status = body.status;
        }
      }

      if (Object.keys(updates).length === 0) {
        return apiFailure('invalid_body', 'No fields to update.', 400);
      }

      if (nextStatus !== null) {
        const actors = await db
          .select({ id: schoolUsers.id })
          .from(schoolUsers)
          .where(
            and(
              eq(schoolUsers.locationId, auth.locationId),
              eq(schoolUsers.firebaseUid, auth.uid),
            ),
          )
          .limit(1);

        if (nextStatus === 'approved') {
          updates.approvedBy = actors[0]?.id ?? null;
          updates.approvedAt = new Date();
        }

        if (nextStatus === 'paid') {
          updates.paidAt = new Date();
        }
      }

      updates.updatedAt = new Date();

      const updated = await db
        .update(payrollRuns)
        .set(updates)
        .where(
          and(
            eq(payrollRuns.id, runId),
            eq(payrollRuns.locationId, auth.locationId),
            // Re-checked in SQL: two administrators approving at the same
            // instant must not both succeed.
            eq(payrollRuns.status, run.status),
          ),
        )
        .returning({ id: payrollRuns.id });

      if (updated[0] === undefined) {
        return apiFailure(
          'invalid_state',
          'This run was changed by someone else a moment ago. Reload and try again.',
          409,
        );
      }

      // A run marked paid carries its payslips with it. Slips already marked
      // paid individually keep their own date and reference.
      if (nextStatus === 'paid') {
        await db
          .update(payslips)
          .set({
            status: 'paid',
            paidOn: new Date().toISOString().slice(0, 10),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(payslips.locationId, auth.locationId),
              eq(payslips.payrollRunId, runId),
              eq(payslips.status, 'unpaid'),
            ),
          );
      }

      return apiSuccess({ run: await getPayrollRun(auth.locationId, runId) });
    } catch (error) {
      if (error instanceof PayrollGenerationError) {
        return apiFailure(error.code, error.message, 400);
      }
      if (error instanceof PayslipNumberError) {
        return apiFailure('numbering_failed', error.message, 400);
      }
      return handleApiError(error);
    }
  },
  { permission: 'payroll.write' },
);
