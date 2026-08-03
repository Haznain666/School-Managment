import 'server-only';

import type { BatchItem } from 'drizzle-orm/batch';
import { and, eq } from 'drizzle-orm';

import { payrollRuns, payslipItems, payslips, staff } from '@/db/schema';

import { db } from './drizzle';
import {
  attendanceTallyByStaff,
  getSalaryAssignmentsByStaff,
  getSchoolPayrollHeader,
  listSalaryComponents,
  toPayrollComponents,
  unpaidLeaveDaysByStaff,
} from './hr-queries';
import { paiseToNumeric } from './money';
import { calculatePayslip } from './payroll-calculator';
import { reservePayslipNumbers } from './payslip-number';

type PgBatchItem = BatchItem<'pg'>;

/**
 * Payroll run generation (Sprint 7).
 *
 * ── What a run actually is ───────────────────────────────────────────────
 * A run is a snapshot, not a view. Every payslip and every line on it copies
 * the figures it was computed from, so revising a salary in November cannot
 * change what June's payslip says. That is the same rule `fee_challan_items`
 * follows, and it exists for the same reason: a teacher holding a printed slip
 * must be able to reconcile it against the system a year later.
 *
 * ── On atomicity ─────────────────────────────────────────────────────────
 * A run writes one `payroll_runs` row, one `payslips` row per staff member and
 * several `payslip_items` rows each. They go out in a single `db.batch()`,
 * which the Neon HTTP driver executes as one transaction — a run that wrote
 * half its payslips and then failed would leave a school paying half its staff.
 *
 * Payslip numbers are reserved in one statement before the batch, for the
 * reason `lib/payslip-number.ts` explains.
 *
 * ── Regeneration ─────────────────────────────────────────────────────────
 * Only a `draft` run may be regenerated, and doing so deletes its payslips
 * first. Once a run is approved it is the school's record of what it owes, and
 * recomputing it silently is how a teacher ends up paid a number nobody
 * authorised.
 */

export class PayrollGenerationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'PayrollGenerationError';
    this.code = code;
  }
}

export interface GenerateRunInput {
  locationId: string;
  runId: string;
  payrollMonth: number;
  payrollYear: number;
  workingDays: number;
  /** Null = every branch of the school. */
  branchId: string | null;
}

export interface GenerateRunResult {
  staffCount: number;
  grossTotalPaise: number;
  deductionTotalPaise: number;
  netTotalPaise: number;
  /** Staff skipped because they have no salary structure. Named, not counted. */
  skipped: Array<{ staffId: string; name: string; reason: string }>;
}

/**
 * Computes and writes every payslip for a run.
 *
 * The run row must already exist and be `draft`; the caller creates it, because
 * that is where the uniqueness of (school, branch, month, year) is enforced.
 */
export async function generatePayrollRun(
  input: GenerateRunInput,
): Promise<GenerateRunResult> {
  const { locationId, runId, payrollMonth, payrollYear, workingDays, branchId } = input;

  const header = await getSchoolPayrollHeader(locationId);
  if (header === null) {
    throw new PayrollGenerationError('not_found', 'School not found.');
  }

  if (header.schoolCode === null || header.schoolCode === '') {
    throw new PayrollGenerationError(
      'school_code_missing',
      'This school has no school code set. Add one in the Super Admin panel before running payroll.',
    );
  }

  // Only active staff are paid. A resigned member is excluded by status rather
  // than by their leaving date, so a school that forgets to set one still does
  // not pay someone who has gone.
  const staffConditions = [eq(staff.locationId, locationId), eq(staff.status, 'active')];
  if (branchId !== null) staffConditions.push(eq(staff.branchId, branchId));

  const staffRows = await db
    .select({
      id: staff.id,
      firstName: staff.firstName,
      lastName: staff.lastName,
      employeeCode: staff.employeeCode,
      designation: staff.designation,
      branchId: staff.branchId,
      bankAccountTitle: staff.bankAccountTitle,
      bankAccountNumber: staff.bankAccountNumber,
      bankName: staff.bankName,
    })
    .from(staff)
    .where(and(...staffConditions));

  if (staffRows.length === 0) {
    throw new PayrollGenerationError(
      'no_staff',
      branchId === null
        ? 'This school has no active staff to pay.'
        : 'This branch has no active staff to pay.',
    );
  }

  const componentRows = await listSalaryComponents(locationId, { activeOnly: true });
  if (componentRows.length === 0) {
    throw new PayrollGenerationError(
      'no_components',
      'Set up your salary components before running payroll.',
    );
  }

  const components = toPayrollComponents(componentRows);

  const staffIds = staffRows.map((row) => row.id);

  const [assignmentsByStaff, unpaidLeave, attendance] = await Promise.all([
    getSalaryAssignmentsByStaff(locationId, staffIds),
    unpaidLeaveDaysByStaff(locationId, payrollMonth, payrollYear),
    attendanceTallyByStaff(locationId, payrollMonth, payrollYear),
  ]);

  const skipped: GenerateRunResult['skipped'] = [];

  const computed = staffRows.flatMap((row) => {
    const assignments = assignmentsByStaff.get(row.id) ?? [];

    if (assignments.length === 0) {
      // Named rather than silently paid zero: a payslip for PKR 0 looks like a
      // decision, and a missing structure is an oversight the school must fix.
      skipped.push({
        staffId: row.id,
        name: `${row.firstName} ${row.lastName}`.trim(),
        reason: 'No salary structure assigned.',
      });
      return [];
    }

    const tally = attendance.get(row.id) ?? { absentDays: 0, halfDays: 0, presentDays: 0 };

    const result = calculatePayslip({
      components,
      assignments,
      unpaidLeaveDays: unpaidLeave.get(row.id) ?? 0,
      absentDays: tally.absentDays,
      halfDays: tally.halfDays,
      workingDays,
    });

    return [{ staffRow: row, result }];
  });

  if (computed.length === 0) {
    throw new PayrollGenerationError(
      'no_structures',
      'None of the active staff have a salary structure yet. Assign one before running payroll.',
    );
  }

  const numbers = await reservePayslipNumbers(
    db,
    locationId,
    header.schoolCode,
    payrollMonth,
    payrollYear,
    computed.length,
  );

  let grossTotalPaise = 0;
  let deductionTotalPaise = 0;
  let netTotalPaise = 0;

  const statements: PgBatchItem[] = [
    // Regeneration: a draft run's previous payslips go first. The line items
    // follow by cascade, so they are not deleted separately.
    db.delete(payslips).where(
      and(eq(payslips.locationId, locationId), eq(payslips.payrollRunId, runId)),
    ),
  ];

  computed.forEach((entry, index) => {
    const { staffRow, result } = entry;
    const payslipId = crypto.randomUUID();
    const payslipNumber = numbers[index];

    if (payslipNumber === undefined) {
      throw new PayrollGenerationError(
        'numbering_failed',
        'Could not reserve enough payslip numbers. Please try again.',
      );
    }

    grossTotalPaise += result.grossEarningsPaise;
    deductionTotalPaise += result.totalDeductionsPaise + result.lossOfPayPaise;
    netTotalPaise += result.netPayablePaise;

    statements.push(
      db.insert(payslips).values({
        id: payslipId,
        locationId,
        payrollRunId: runId,
        staffId: staffRow.id,
        branchId: staffRow.branchId,
        payslipNumber,
        staffName: `${staffRow.firstName} ${staffRow.lastName}`.trim(),
        employeeCode: staffRow.employeeCode,
        designation: staffRow.designation,
        bankAccountTitle: staffRow.bankAccountTitle,
        bankAccountNumber: staffRow.bankAccountNumber,
        bankName: staffRow.bankName,
        grossEarnings: paiseToNumeric(result.grossEarningsPaise),
        totalDeductions: paiseToNumeric(result.totalDeductionsPaise),
        lossOfPayDays: result.lossOfPayDays.toFixed(1),
        lossOfPayAmount: paiseToNumeric(result.lossOfPayPaise),
        netPayable: paiseToNumeric(result.netPayablePaise),
        status: 'unpaid',
      }),
    );

    for (const line of result.lines) {
      statements.push(
        db.insert(payslipItems).values({
          locationId,
          payslipId,
          componentId: line.componentId,
          description: line.description,
          kind: line.kind,
          amount: paiseToNumeric(line.amountPaise),
          sortOrder: line.sortOrder,
        }),
      );
    }

    // Loss of pay is a line on the slip, not just a total. A teacher docked for
    // three days should see the three days and the rupees, not a net figure
    // that is lower than last month for no stated reason.
    if (result.lossOfPayPaise > 0) {
      statements.push(
        db.insert(payslipItems).values({
          locationId,
          payslipId,
          componentId: null,
          description: `Loss of pay (${result.lossOfPayDays} day${result.lossOfPayDays === 1 ? '' : 's'})`,
          kind: 'deduction',
          amount: paiseToNumeric(result.lossOfPayPaise),
          sortOrder: 900,
        }),
      );
    }
  });

  statements.push(
    db
      .update(payrollRuns)
      .set({
        staffCount: computed.length,
        grossTotal: paiseToNumeric(grossTotalPaise),
        deductionTotal: paiseToNumeric(deductionTotalPaise),
        netTotal: paiseToNumeric(netTotalPaise),
        updatedAt: new Date(),
      })
      .where(and(eq(payrollRuns.id, runId), eq(payrollRuns.locationId, locationId))),
  );

  await db.batch(statements as [PgBatchItem, ...PgBatchItem[]]);

  return {
    staffCount: computed.length,
    grossTotalPaise,
    deductionTotalPaise,
    netTotalPaise,
    skipped,
  };
}
