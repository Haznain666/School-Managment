import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { academicYears } from './academic-years';
import { schools } from './schools';
import { studentProfiles } from './student-profiles';

export const CHALLAN_STATUSES = [
  'unpaid',
  'partial',
  'paid',
  'cancelled',
  'waived',
] as const;
export type ChallanStatus = (typeof CHALLAN_STATUSES)[number];

export const CHALLAN_STATUS_LABELS: Record<ChallanStatus, string> = {
  unpaid: 'Unpaid',
  partial: 'Partially paid',
  paid: 'Paid',
  cancelled: 'Cancelled',
  waived: 'Waived',
};

/** Statuses that still owe the school money. */
export const OUTSTANDING_CHALLAN_STATUSES: readonly ChallanStatus[] = [
  'unpaid',
  'partial',
];

/** Statuses that can still receive a payment. */
export const PAYABLE_CHALLAN_STATUSES: readonly ChallanStatus[] = ['unpaid', 'partial'];

/**
 * fee_challans — one bill, for one student, for one billing period.
 *
 * A challan is a printed document a parent takes to a bank, so it is immutable
 * in the ways that matter: the amounts are copied onto `fee_challan_items` at
 * generation time rather than joined from `fee_structures` at read time. If a
 * school raises tuition in March, February's challan must still explain the
 * number the parent actually paid.
 *
 * `total_amount` is stored rather than derived for the same reason, and
 * `paid_amount` is maintained alongside `fee_payments` so a list of two
 * thousand challans does not need an aggregate per row.
 *
 * The unique key stops the commonest operational error: generating July's
 * challans twice and billing every family double. Bulk generation relies on it
 * to skip rather than duplicate.
 */
export const feeChallans = pgTable(
  'fee_challans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    studentProfileId: uuid('student_profile_id')
      .notNull()
      .references(() => studentProfiles.id, { onDelete: 'cascade' }),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYears.id),
    /** Printed on the document, e.g. `GVS-2025-07-0001`. Globally unique. */
    challanNumber: text('challan_number').notNull().unique(),
    /** 1-12. Null for one-time and annual challans, which have no month. */
    billingMonth: integer('billing_month'),
    billingYear: integer('billing_year'),
    dueDate: date('due_date').notNull(),
    issueDate: date('issue_date').notNull().defaultNow(),
    /** Sum of line items before concessions. */
    subtotal: numeric('subtotal', { precision: 10, scale: 2 }).notNull(),
    concessionAmount: numeric('concession_amount', { precision: 10, scale: 2 })
      .notNull()
      .default('0'),
    lateFeeAmount: numeric('late_fee_amount', { precision: 10, scale: 2 })
      .notNull()
      .default('0'),
    /** subtotal - concession + late fee. */
    totalAmount: numeric('total_amount', { precision: 10, scale: 2 }).notNull(),
    paidAmount: numeric('paid_amount', { precision: 10, scale: 2 })
      .notNull()
      .default('0'),
    status: text('status').notNull().default('unpaid').$type<ChallanStatus>(),
    notes: text('notes'),
    /** Firebase uid of whoever generated it. */
    generatedByUid: text('generated_by_uid'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('fee_challans_location_id_idx').on(table.locationId),
    index('fee_challans_student_profile_id_idx').on(table.studentProfileId),
    index('fee_challans_location_id_status_idx').on(table.locationId, table.status),
    index('fee_challans_location_id_due_date_idx').on(table.locationId, table.dueDate),
    // One challan per student per billing period. This is what makes bulk
    // generation safe to re-run.
    uniqueIndex('fee_challans_student_period_idx').on(
      table.studentProfileId,
      table.billingMonth,
      table.billingYear,
      table.academicYearId,
    ),
    check(
      'fee_challans_status_check',
      sql`${table.status} IN ('unpaid', 'partial', 'paid', 'cancelled', 'waived')`,
    ),
    check(
      'fee_challans_billing_month_check',
      sql`${table.billingMonth} IS NULL OR ${table.billingMonth} BETWEEN 1 AND 12`,
    ),
  ],
);

export type FeeChallan = typeof feeChallans.$inferSelect;
export type NewFeeChallan = typeof feeChallans.$inferInsert;

export function isChallanStatus(value: unknown): value is ChallanStatus {
  return (
    typeof value === 'string' && (CHALLAN_STATUSES as readonly string[]).includes(value)
  );
}
