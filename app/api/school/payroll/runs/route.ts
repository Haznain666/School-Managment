import { and, eq } from 'drizzle-orm';

import { isPayrollRunStatus, payrollRuns, schoolUsers } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { listPayrollRuns } from '@/lib/hr-queries';
import { defaultWorkingDays } from '@/lib/payroll-calculator';
import {
  generatePayrollRun,
  PayrollGenerationError,
} from '@/lib/payroll-generation';
import { PayslipNumberError } from '@/lib/payslip-number';
import { isUuid, readOptionalString } from '@/lib/validation';

/**
 * /api/school/payroll/runs
 *
 * GET  the school's payroll runs, newest period first
 * POST raise one for a month and compute every payslip in it
 *
 * ── Why the run row is created before the payslips ───────────────────────
 * The unique index on (location, branch, month, year) is what stops the same
 * month being run twice by two administrators at once, and only an insert can
 * test it. So the row goes in first: if it conflicts, the request stops before
 * a single payslip number has been burned. Generation then fills it in.
 *
 * A conflict is answered with the existing run's id rather than a bare 409, so
 * the caller can offer to open it — a school that clicked twice wants to see
 * the run, not an error.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);
      const statusParam = url.searchParams.get('status');
      const yearParam = Number(url.searchParams.get('year'));

      return apiSuccess({
        runs: await listPayrollRuns(auth.locationId, {
          status: isPayrollRunStatus(statusParam) ? statusParam : undefined,
          year: Number.isInteger(yearParam) && yearParam > 2000 ? yearParam : undefined,
        }),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'payroll.read' },
);

interface CreateRunBody {
  payrollMonth?: unknown;
  payrollYear?: unknown;
  workingDays?: unknown;
  branchId?: unknown;
  notes?: unknown;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<CreateRunBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const payrollMonth = Number(body.payrollMonth);
      if (!Number.isInteger(payrollMonth) || payrollMonth < 1 || payrollMonth > 12) {
        return apiFailure('invalid_body', 'Choose a month between 1 and 12.', 400);
      }

      const payrollYear = Number(body.payrollYear);
      if (!Number.isInteger(payrollYear) || payrollYear < 2000 || payrollYear > 2100) {
        return apiFailure('invalid_body', 'Choose a valid year.', 400);
      }

      // Payroll for a month that has not started yet is almost always a typo
      // in the year, and the cost of catching it is one rejected request.
      const now = new Date();
      const requestedStart = Date.UTC(payrollYear, payrollMonth - 1, 1);
      if (requestedStart > Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) {
        return apiFailure(
          'invalid_body',
          'That month has not started yet.',
          400,
        );
      }

      const workingDaysRaw = body.workingDays;
      const workingDays =
        workingDaysRaw === undefined || workingDaysRaw === null
          ? defaultWorkingDays(payrollMonth, payrollYear)
          : Number(workingDaysRaw);

      if (!Number.isInteger(workingDays) || workingDays < 1 || workingDays > 31) {
        return apiFailure(
          'invalid_body',
          'The working days must be a whole number between 1 and 31.',
          400,
        );
      }

      const requestedBranch = readOptionalString(body.branchId);
      if (requestedBranch !== null && !isUuid(requestedBranch)) {
        return apiFailure('invalid_body', 'Choose a valid branch.', 400);
      }
      const branchId = requestedBranch;

      const generators = await db
        .select({ id: schoolUsers.id })
        .from(schoolUsers)
        .where(
          and(
            eq(schoolUsers.locationId, auth.locationId),
            eq(schoolUsers.authUserId, auth.uid),
          ),
        )
        .limit(1);

      const created = await db
        .insert(payrollRuns)
        .values({
          // Tenant comes from the verified session, never from the body.
          locationId: auth.locationId,
          branchId,
          payrollMonth,
          payrollYear,
          workingDays,
          status: 'draft',
          notes: readOptionalString(body.notes),
          generatedBy: generators[0]?.id ?? null,
        })
        .onConflictDoNothing()
        .returning({ id: payrollRuns.id });

      const runId = created[0]?.id;

      if (runId === undefined) {
        const existing = await db
          .select({ id: payrollRuns.id, status: payrollRuns.status })
          .from(payrollRuns)
          .where(
            and(
              eq(payrollRuns.locationId, auth.locationId),
              eq(payrollRuns.payrollMonth, payrollMonth),
              eq(payrollRuns.payrollYear, payrollYear),
            ),
          )
          .limit(1);

        return apiFailure(
          'duplicate',
          existing[0] === undefined
            ? 'That payroll period has already been run.'
            : `Payroll for that month already exists and is ${existing[0].status}.`,
          409,
        );
      }

      let result;
      try {
        result = await generatePayrollRun({
          locationId: auth.locationId,
          runId,
          payrollMonth,
          payrollYear,
          workingDays,
          branchId,
        });
      } catch (generationError) {
        // The run row was inserted first to claim the period, so a generation
        // that fails must give it back. Leaving an empty draft behind would
        // make the unique index refuse the retry that fixes the cause.
        await db
          .delete(payrollRuns)
          .where(
            and(eq(payrollRuns.id, runId), eq(payrollRuns.locationId, auth.locationId)),
          )
          .catch((cleanupError: unknown) => {
            console.error('[payroll] could not roll back the empty run:', cleanupError);
          });

        throw generationError;
      }

      return apiSuccess(
        {
          runId,
          staffCount: result.staffCount,
          skipped: result.skipped,
        },
        201,
      );
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
