import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { branches } from './branches';
import { schoolUsers } from './school-users';
import { schools } from './schools';

export const PAYROLL_RUN_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'paid',
  'cancelled',
] as const;
export type PayrollRunStatus = (typeof PAYROLL_RUN_STATUSES)[number];

export const PAYROLL_RUN_STATUS_LABELS: Record<PayrollRunStatus, string> = {
  draft: 'Draft',
  pending_approval: 'Awaiting approval',
  approved: 'Approved',
  paid: 'Paid',
  cancelled: 'Cancelled',
};

/**
 * The transitions a run is allowed to make.
 *
 * A run is regenerable only while `draft`. Once approved it is the school's
 * record of what it owes its staff, and once paid it is the record of what left
 * the bank — neither may be recomputed, because a payslip already handed to a
 * teacher would stop matching the figure they were paid. `cancelled` is the
 * escape hatch for a run raised in error, and it is terminal.
 *
 * ── `pending_approval`, added in Sprint 27 ───────────────────────────────
 * The state a run sits in while the heads who are answerable for its teachers
 * and coordinators sign their own slice of it. It goes forward to `approved`
 * only when **every** slice is signed, and a rejection returns it to `draft` so
 * the next submission is a clean sheet rather than a half-signed one.
 *
 * `draft → approved` is deliberately still here. A school with no principal at
 * all — and there are such schools — needs nobody's approval, and a sprint that
 * froze their payroll behind a role they have never appointed would be a
 * feature that broke a working product. `resolveRunApprovers` returns nobody in
 * that case and `payroll.write` approves as it always did.
 */
export const PAYROLL_RUN_TRANSITIONS: Record<PayrollRunStatus, readonly PayrollRunStatus[]> =
  {
    draft: ['pending_approval', 'approved', 'cancelled'],
    pending_approval: ['approved', 'draft', 'cancelled'],
    approved: ['paid', 'cancelled'],
    paid: [],
    cancelled: [],
  };

/**
 * payroll_runs — one month of payroll for a school, or for one of its branches.
 *
 * Unique on (location, branch, month, year) so a month cannot be run twice by
 * two administrators at once. `branchId` null means the whole school; a school
 * that pays branch by branch gets one run each. Because Postgres treats every
 * NULL as unequal to every other, a second partial index covers the
 * whole-school case — without it, July could be raised twice.
 *
 * The three totals are stored rather than summed from the payslips at read
 * time: the listing shows twelve months at a glance, and summing thousands of
 * payslip rows for a page that only needs a number is work nobody asked for.
 * They are written from the same batch that writes the payslips.
 */
export const payrollRuns = pgTable(
  'payroll_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    /** Null = every branch of the school in one run. */
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
    /** 1-12. */
    payrollMonth: integer('payroll_month').notNull(),
    payrollYear: integer('payroll_year').notNull(),
    status: text('status').notNull().default('draft').$type<PayrollRunStatus>(),
    /** Working days in the month, the denominator for loss of pay. */
    workingDays: integer('working_days').notNull().default(26),
    staffCount: integer('staff_count').notNull().default(0),
    grossTotal: numeric('gross_total', { precision: 14, scale: 2 }).notNull().default('0'),
    deductionTotal: numeric('deduction_total', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    netTotal: numeric('net_total', { precision: 14, scale: 2 }).notNull().default('0'),
    notes: text('notes'),
    generatedBy: uuid('generated_by').references(() => schoolUsers.id, {
      onDelete: 'set null',
    }),
    approvedBy: uuid('approved_by').references(() => schoolUsers.id, {
      onDelete: 'set null',
    }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('payroll_runs_location_id_idx').on(table.locationId),
    index('payroll_runs_location_id_status_idx').on(table.locationId, table.status),
    uniqueIndex('payroll_runs_location_branch_period_idx').on(
      table.locationId,
      table.branchId,
      table.payrollMonth,
      table.payrollYear,
    ),
    // Postgres treats every NULL as unequal to every other, so the index above
    // does not stop the whole-school run for July being raised twice. This
    // partial index covers exactly that case.
    uniqueIndex('payroll_runs_location_period_whole_school_idx')
      .on(table.locationId, table.payrollMonth, table.payrollYear)
      .where(sql`branch_id IS NULL`),
    check(
      'payroll_runs_status_check',
      sql`${table.status} IN ('draft', 'pending_approval', 'approved', 'paid', 'cancelled')`,
    ),
    check(
      'payroll_runs_payroll_month_check',
      sql`${table.payrollMonth} >= 1 AND ${table.payrollMonth} <= 12`,
    ),
    check(
      'payroll_runs_payroll_year_check',
      sql`${table.payrollYear} >= 2000 AND ${table.payrollYear} <= 2100`,
    ),
    check(
      'payroll_runs_working_days_check',
      sql`${table.workingDays} >= 1 AND ${table.workingDays} <= 31`,
    ),
  ],
);

export type PayrollRun = typeof payrollRuns.$inferSelect;
export type NewPayrollRun = typeof payrollRuns.$inferInsert;

export function isPayrollRunStatus(value: unknown): value is PayrollRunStatus {
  return (
    typeof value === 'string' && (PAYROLL_RUN_STATUSES as readonly string[]).includes(value)
  );
}

/** Whether a run may move from one status to another. */
export function canTransitionRun(
  from: PayrollRunStatus,
  to: PayrollRunStatus,
): boolean {
  return PAYROLL_RUN_TRANSITIONS[from].includes(to);
}

export const PAYROLL_MONTH_NAMES: readonly string[] = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** `7, 2025` -> `July 2025`. */
export function formatPayrollPeriod(month: number, year: number): string {
  return `${PAYROLL_MONTH_NAMES[month - 1] ?? String(month)} ${year}`;
}
