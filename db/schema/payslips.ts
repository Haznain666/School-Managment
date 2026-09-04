import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { branches } from './branches';
import { payrollRuns } from './payroll-runs';
import { schoolUsers } from './school-users';
import { schools } from './schools';
import { staff } from './staff';

export const PAYSLIP_STATUSES = ['unpaid', 'paid', 'held'] as const;
export type PayslipStatus = (typeof PAYSLIP_STATUSES)[number];

export const PAYSLIP_STATUS_LABELS: Record<PayslipStatus, string> = {
  unpaid: 'Unpaid',
  paid: 'Paid',
  held: 'Held',
};

export const PAYMENT_MODES = ['bank_transfer', 'cash', 'cheque'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export const PAYMENT_MODE_LABELS: Record<PaymentMode, string> = {
  bank_transfer: 'Bank transfer',
  cash: 'Cash',
  cheque: 'Cheque',
};

/**
 * payslips — what one staff member is paid for one run.
 *
 * ── Everything here is a snapshot ────────────────────────────────────────
 * The name, designation, bank details and every amount are copied onto the row
 * at generation time rather than joined from `staff` at read time. The reason
 * is the same one `fee_challan_items` has: a teacher who transfers branch in
 * October, or whose salary is revised in November, must not find that last
 * June's payslip now says something different from the paper they were handed.
 *
 * `lossOfPayDays` is stored alongside the amounts because a teacher querying a
 * short payment asks "how many days did you dock me?", and recomputing it from
 * leave and attendance months later would not necessarily give the same answer
 * — the register can be corrected after the fact.
 */
export const payslips = pgTable(
  'payslips',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    payrollRunId: uuid('payroll_run_id')
      .notNull()
      .references(() => payrollRuns.id, { onDelete: 'cascade' }),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
    /** `GVS-PS-2025-07-0001`. Unique platform-wide; issued atomically. */
    payslipNumber: text('payslip_number').notNull().unique(),

    // -- Snapshot of who was paid ------------------------------------------
    staffName: text('staff_name').notNull(),
    employeeCode: text('employee_code').notNull(),
    designation: text('designation'),
    bankAccountTitle: text('bank_account_title'),
    bankAccountNumber: text('bank_account_number'),
    bankName: text('bank_name'),

    // -- Snapshot of what they were paid -----------------------------------
    /** Sum of the earning lines before loss of pay. */
    grossEarnings: numeric('gross_earnings', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    /** Sum of the deduction lines, excluding loss of pay. */
    totalDeductions: numeric('total_deductions', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    /** Days docked, half days allowed. */
    lossOfPayDays: numeric('loss_of_pay_days', { precision: 4, scale: 1 })
      .notNull()
      .default('0'),
    /** The rupee value of those days. Broken out so a payslip can explain it. */
    lossOfPayAmount: numeric('loss_of_pay_amount', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    /**
     * A head's replacement for `loss_of_pay_amount`, or null (Sprint 27).
     *
     * ── The replacement, not a delta ─────────────────────────────────────
     * Null means no override. A value means *this is the loss of pay for this
     * payslip* — `0.00` waives the deduction entirely, which is the common
     * case and the reason it is a replacement: a delta of "minus everything"
     * is a number somebody has to compute, and computing it wrong pays a
     * teacher more than their gross.
     *
     * ── `loss_of_pay_amount` is kept, never overwritten ──────────────────
     * A teacher asking why they were paid more than the register implies is
     * owed **both** numbers: what the attendance said, and what the head
     * decided. Overwriting the first would erase the question along with the
     * answer, and the payslip would be a document that had never disagreed
     * with anything.
     */
    lossOfPayOverride: numeric('loss_of_pay_override', { precision: 12, scale: 2 }),
    /**
     * Why the deduction was changed. Required by the API whenever the override
     * is set, because a waived deduction with no reason is a figure nobody can
     * defend six months later.
     */
    overrideReason: text('override_reason'),
    overriddenBy: uuid('overridden_by').references(() => schoolUsers.id, {
      onDelete: 'set null',
    }),
    overriddenAt: timestamp('overridden_at', { withTimezone: true }),
    /**
     * grossEarnings - totalDeductions - (override ?? lossOfPayAmount), never
     * below zero. Recomputed when an override is set, and the CHECK below
     * still holds — an override cannot pay somebody a negative salary.
     */
    netPayable: numeric('net_payable', { precision: 12, scale: 2 }).notNull().default('0'),

    status: text('status').notNull().default('unpaid').$type<PayslipStatus>(),
    paymentMode: text('payment_mode').$type<PaymentMode>(),
    paidOn: date('paid_on'),
    paymentReference: text('payment_reference'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('payslips_location_id_idx').on(table.locationId),
    index('payslips_payroll_run_id_idx').on(table.payrollRunId),
    index('payslips_location_id_status_idx').on(table.locationId, table.status),
    index('payslips_staff_id_idx').on(table.staffId),
    // One payslip per staff member per run. Regeneration deletes and re-inserts
    // within a draft run rather than accumulating duplicates.
    uniqueIndex('payslips_run_staff_idx').on(table.payrollRunId, table.staffId),
    check(
      'payslips_status_check',
      sql`${table.status} IN ('unpaid', 'paid', 'held')`,
    ),
    check(
      'payslips_payment_mode_check',
      sql`${table.paymentMode} IS NULL OR ${table.paymentMode} IN ('bank_transfer', 'cash', 'cheque')`,
    ),
    check('payslips_net_payable_check', sql`${table.netPayable} >= 0`),
  ],
);

export type Payslip = typeof payslips.$inferSelect;
export type NewPayslip = typeof payslips.$inferInsert;

export function isPayslipStatus(value: unknown): value is PayslipStatus {
  return typeof value === 'string' && (PAYSLIP_STATUSES as readonly string[]).includes(value);
}

export function isPaymentMode(value: unknown): value is PaymentMode {
  return typeof value === 'string' && (PAYMENT_MODES as readonly string[]).includes(value);
}
