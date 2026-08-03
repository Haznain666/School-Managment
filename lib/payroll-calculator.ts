import { clampPaise, percentOfPaise, toPaise, type MoneyInput } from './money';

/**
 * Payroll arithmetic (Sprint 7).
 *
 * Deliberately dependency-free apart from `lib/money.ts`: no database, no
 * `server-only`. The payroll preview in the browser must compute exactly what
 * the server stores, and the only way to guarantee that is for both to run this
 * same code. It is the same arrangement `lib/fee-calculator.ts` has with the
 * challan generator, and for the same reason — a school shown one number and
 * charged another stops trusting the system.
 *
 * Everything here works in integer paise. Never add or compare two rupee
 * strings; convert with `toPaise`, work in paise, finish with `paiseToNumeric`.
 */

/** A component as payroll needs to see it, independent of the DB row shape. */
export interface PayrollComponent {
  id: string;
  name: string;
  kind: 'earning' | 'deduction';
  calculation: 'fixed' | 'percent_of_basic';
  isBasic: boolean;
  /** Whether unpaid days reduce this head. */
  proratedByAttendance: boolean;
  sortOrder: number;
}

/** What one staff member is assigned under one component. */
export interface PayrollAssignment {
  componentId: string;
  /** Rupees, used when the component is `fixed`. */
  amount: MoneyInput;
  /** Hundredths of a percent; overrides the component default when set. */
  percentBasisPoints: number | null;
  /** The component's own default, used when the assignment does not override. */
  defaultPercentBasisPoints: number | null;
}

/** One computed line, in paise. */
export interface PayrollLine {
  componentId: string;
  description: string;
  kind: 'earning' | 'deduction';
  amountPaise: number;
  sortOrder: number;
}

export interface PayrollResult {
  lines: PayrollLine[];
  /** Sum of the earning lines, before loss of pay. */
  grossEarningsPaise: number;
  /** Sum of the deduction lines, excluding loss of pay. */
  totalDeductionsPaise: number;
  /** Days docked. */
  lossOfPayDays: number;
  /** The rupee value of those days, in paise. */
  lossOfPayPaise: number;
  /** gross - deductions - loss of pay, floored at zero. */
  netPayablePaise: number;
}

/**
 * The basic-salary figure every percentage head is measured against.
 *
 * Returns 0 when the school has no component flagged `isBasic`, or the staff
 * member has no assignment against it. That is not an error worth throwing on:
 * it makes every percentage head come out at zero, which is visible on the
 * payslip preview before anyone is paid, whereas a thrown error would block a
 * whole run because one person's structure is half filled in.
 */
export function basicSalaryPaise(
  components: readonly PayrollComponent[],
  assignments: readonly PayrollAssignment[],
): number {
  const basic = components.find((component) => component.isBasic);
  if (basic === undefined) return 0;

  const assignment = assignments.find((row) => row.componentId === basic.id);
  if (assignment === undefined) return 0;

  return Math.max(0, toPaise(assignment.amount));
}

/** The rate an assignment resolves to, in hundredths of a percent. */
function resolvePercentBasisPoints(assignment: PayrollAssignment): number {
  const own = assignment.percentBasisPoints;
  if (own !== null && Number.isFinite(own)) return own;

  const fallback = assignment.defaultPercentBasisPoints;
  return fallback !== null && Number.isFinite(fallback) ? fallback : 0;
}

/**
 * The value of one component for one staff member, in paise, before any
 * loss-of-pay proration.
 */
export function componentAmountPaise(
  component: PayrollComponent,
  assignment: PayrollAssignment,
  basicPaise: number,
): number {
  if (component.calculation === 'percent_of_basic') {
    // Basis points are hundredths of a percent, so 4500 is 45%. Dividing by 100
    // here and letting `percentOfPaise` round once keeps 45% of 30,000.00 at
    // exactly 13,500.00 rather than a paisa either side.
    return Math.max(0, percentOfPaise(basicPaise, resolvePercentBasisPoints(assignment) / 100));
  }

  return Math.max(0, toPaise(assignment.amount));
}

/**
 * Loss-of-pay days for a month.
 *
 * Two sources, added together and capped at the working days in the month:
 *   - approved leave whose type is unpaid
 *   - unexcused absences on the staff register, with a half day counting half
 *
 * The cap matters. A register marked absent for a day that is also covered by
 * approved unpaid leave would otherwise dock the same day twice, and a teacher
 * docked 32 days in a 26-day month would end up owing the school money.
 */
export function lossOfPayDays(input: {
  unpaidLeaveDays: number;
  absentDays: number;
  halfDays: number;
  workingDays: number;
}): number {
  const unpaidLeave = Number.isFinite(input.unpaidLeaveDays)
    ? Math.max(0, input.unpaidLeaveDays)
    : 0;
  const absent = Number.isFinite(input.absentDays) ? Math.max(0, input.absentDays) : 0;
  const half = Number.isFinite(input.halfDays) ? Math.max(0, input.halfDays) : 0;

  const total = unpaidLeave + absent + half * 0.5;
  const cap = Number.isFinite(input.workingDays) && input.workingDays > 0
    ? input.workingDays
    : 26;

  // Half-day granularity: payroll never docks a fraction finer than that.
  return Math.min(Math.round(total * 2) / 2, cap);
}

/**
 * The rupee value of the docked days.
 *
 * Only components marked `proratedByAttendance` are reduced. A fixed
 * reimbursement a school pays regardless of attendance is not — and neither is
 * a statutory deduction, which is why deductions are excluded outright: docking
 * a day should not also reduce the tax withheld, or the payslip stops
 * reconciling against the school's filings.
 */
export function lossOfPayAmountPaise(
  lines: readonly PayrollLine[],
  proratedComponentIds: ReadonlySet<string>,
  days: number,
  workingDays: number,
): number {
  if (days <= 0) return 0;

  const denominator = workingDays > 0 ? workingDays : 26;

  const proratableBase = lines
    .filter((line) => line.kind === 'earning' && proratedComponentIds.has(line.componentId))
    .reduce((sum, line) => sum + line.amountPaise, 0);

  if (proratableBase <= 0) return 0;

  const perDay = proratableBase / denominator;
  return clampPaise(Math.round(perDay * days), 0, proratableBase);
}

/**
 * The whole payslip for one staff member.
 *
 * Components with no assignment are omitted rather than shown at zero: a
 * payslip listing six allowances a teacher does not receive is harder to read
 * than one listing the three they do.
 */
export function calculatePayslip(input: {
  components: readonly PayrollComponent[];
  assignments: readonly PayrollAssignment[];
  unpaidLeaveDays: number;
  absentDays: number;
  halfDays: number;
  workingDays: number;
}): PayrollResult {
  const basicPaise = basicSalaryPaise(input.components, input.assignments);

  const byId = new Map(input.assignments.map((row) => [row.componentId, row]));

  const lines: PayrollLine[] = [];
  const proratedComponentIds = new Set<string>();

  for (const component of input.components) {
    const assignment = byId.get(component.id);
    if (assignment === undefined) continue;

    const amountPaise = componentAmountPaise(component, assignment, basicPaise);
    if (amountPaise === 0 && component.calculation === 'fixed') continue;

    if (component.proratedByAttendance) proratedComponentIds.add(component.id);

    lines.push({
      componentId: component.id,
      description: component.name,
      kind: component.kind,
      amountPaise,
      sortOrder: component.sortOrder,
    });
  }

  lines.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'earning' ? -1 : 1;
    return left.sortOrder - right.sortOrder;
  });

  const grossEarningsPaise = lines
    .filter((line) => line.kind === 'earning')
    .reduce((sum, line) => sum + line.amountPaise, 0);

  const totalDeductionsPaise = lines
    .filter((line) => line.kind === 'deduction')
    .reduce((sum, line) => sum + line.amountPaise, 0);

  const days = lossOfPayDays({
    unpaidLeaveDays: input.unpaidLeaveDays,
    absentDays: input.absentDays,
    halfDays: input.halfDays,
    workingDays: input.workingDays,
  });

  const lossOfPayPaise = lossOfPayAmountPaise(
    lines,
    proratedComponentIds,
    days,
    input.workingDays,
  );

  // Floored at zero. Deductions exceeding earnings is a data-entry mistake, and
  // a negative net would print as a payslip that asks a teacher for money.
  const netPayablePaise = Math.max(
    0,
    grossEarningsPaise - totalDeductionsPaise - lossOfPayPaise,
  );

  return {
    lines,
    grossEarningsPaise,
    totalDeductionsPaise,
    lossOfPayDays: days,
    lossOfPayPaise,
    netPayablePaise,
  };
}

/**
 * Working days in a month, Monday to Saturday.
 *
 * The Pakistani school week runs six days, so Sunday is the only weekend day
 * excluded. Offered as a default when a run is raised; the administrator can
 * override it, because public holidays and vacation vary by school and by
 * province and no calendar this code could ship would be right for all of them.
 */
export function defaultWorkingDays(month: number, year: number): number {
  if (!Number.isInteger(month) || month < 1 || month > 12) return 26;
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return 26;

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  let working = 0;
  for (let day = 1; day <= daysInMonth; day += 1) {
    if (new Date(Date.UTC(year, month - 1, day)).getUTCDay() !== 0) working += 1;
  }

  return working;
}

/** The first and last calendar day of a payroll month, as ISO dates. */
export function payrollMonthRange(
  month: number,
  year: number,
): { start: string; end: string } {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const padded = String(month).padStart(2, '0');

  return {
    start: `${year}-${padded}-01`,
    end: `${year}-${padded}-${String(daysInMonth).padStart(2, '0')}`,
  };
}

/**
 * The share of an approved leave request that falls inside a payroll month.
 *
 * A request spanning the month boundary — 28 June to 3 July — must dock June's
 * payslip for its June days and July's for its July days, not the whole thing
 * twice. The request's own `totalDays` is apportioned by calendar days rather
 * than recomputed, so a half day recorded on a one-day request stays a half day.
 */
export function leaveDaysInMonth(
  request: { startDate: string; endDate: string; totalDays: number },
  month: number,
  year: number,
): number {
  const { start, end } = payrollMonthRange(month, year);

  const requestStart = Date.parse(`${request.startDate}T00:00:00Z`);
  const requestEnd = Date.parse(`${request.endDate}T00:00:00Z`);
  const monthStart = Date.parse(`${start}T00:00:00Z`);
  const monthEnd = Date.parse(`${end}T00:00:00Z`);

  if (Number.isNaN(requestStart) || Number.isNaN(requestEnd)) return 0;

  const overlapStart = Math.max(requestStart, monthStart);
  const overlapEnd = Math.min(requestEnd, monthEnd);
  if (overlapEnd < overlapStart) return 0;

  const dayMs = 86_400_000;
  const overlapDays = Math.round((overlapEnd - overlapStart) / dayMs) + 1;
  const requestDays = Math.round((requestEnd - requestStart) / dayMs) + 1;

  if (requestDays <= 0) return 0;
  if (overlapDays >= requestDays) return request.totalDays;

  // Half-day granularity, same as `lossOfPayDays`.
  return Math.round(((request.totalDays * overlapDays) / requestDays) * 2) / 2;
}
