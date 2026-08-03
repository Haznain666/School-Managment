import { and, asc, eq, sql } from 'drizzle-orm';

import { payrollRuns, payslipItems, payslips } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { db } from '@/lib/drizzle';

/**
 * GET /api/school/payroll/reports/summary?year=2025
 *
 * The salary bill for a year: what each month cost, and what the money went on
 * broken down by head.
 *
 * Both figures come from the payslips rather than from the staff structures,
 * because the two are not the same number and the difference is the point — a
 * month with heavy unpaid leave costs less than the structures say it should,
 * and a school reconciling against its bank needs what it actually paid.
 *
 * Cancelled runs are excluded: a run raised in error is not a cost.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);
      const year = Number(url.searchParams.get('year') ?? new Date().getFullYear());

      if (!Number.isInteger(year) || year < 2000 || year > 2100) {
        return apiFailure('invalid_body', 'Choose a valid year.', 400);
      }

      const [monthly, byComponent] = await Promise.all([
        db
          .select({
            payrollMonth: payrollRuns.payrollMonth,
            status: payrollRuns.status,
            staffCount: payrollRuns.staffCount,
            grossTotal: payrollRuns.grossTotal,
            deductionTotal: payrollRuns.deductionTotal,
            netTotal: payrollRuns.netTotal,
          })
          .from(payrollRuns)
          .where(
            and(
              eq(payrollRuns.locationId, auth.locationId),
              eq(payrollRuns.payrollYear, year),
            ),
          )
          .orderBy(asc(payrollRuns.payrollMonth)),

        db
          .select({
            description: payslipItems.description,
            kind: payslipItems.kind,
            total: sql<string>`sum(${payslipItems.amount})`,
          })
          .from(payslipItems)
          .innerJoin(payslips, eq(payslips.id, payslipItems.payslipId))
          .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.payrollRunId))
          .where(
            and(
              eq(payslipItems.locationId, auth.locationId),
              eq(payrollRuns.payrollYear, year),
            ),
          )
          .groupBy(payslipItems.description, payslipItems.kind)
          .orderBy(asc(payslipItems.kind), asc(payslipItems.description)),
      ]);

      const active = monthly.filter((row) => row.status !== 'cancelled');

      const yearTotals = active.reduce(
        (totals, row) => ({
          gross: totals.gross + Number.parseFloat(row.grossTotal),
          deductions: totals.deductions + Number.parseFloat(row.deductionTotal),
          net: totals.net + Number.parseFloat(row.netTotal),
        }),
        { gross: 0, deductions: 0, net: 0 },
      );

      return apiSuccess({
        year,
        monthly: active,
        byComponent,
        yearTotals: {
          gross: yearTotals.gross.toFixed(2),
          deductions: yearTotals.deductions.toFixed(2),
          net: yearTotals.net.toFixed(2),
        },
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'payroll.read' },
);
