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
export const OPEN_CHALLAN_STATUSES: readonly ChallanStatus[] = ['unpaid', 'partial'];

/**
 * fee_challans — one bill, for one student, for one billing period.
 *
 * A challan is the printed slip a parent takes to the bank, so it is a record
 * of what was demanded, not a live view of the price list: `subtotal`,
 * `concession_amount` and `total_amount` are frozen at generation time. If the
 * school raises tuition in March, February's challan still says what it said.
 *
 * `challan_number` is globally unique because it already carries the school
 * code (`GVS-2025-07-0001`), and because a bank teller reading one off a slip
 * has no tenant to scope it by. `lib/challan-number.ts` issues them atomically.
 *
 * The unique key on (student, month, year, academic year) is what makes bulk
 * generation safely re-runnable: a second run for July skips whoever already
 * has a July challan instead of billing them twice. One-off challans carry a
 * null `billing_month`, and Postgres treats nulls as distinct, so a student may
 * hold several of those.
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
    /** `GVS-2025-07-0001`. Unique across the platform. */
    challanNumber: text('challan_number').notNull().unique(),
    /** 1–12. Null for a one-off challan that is not tied to a month. */
    billingMonth: integer('billing_month'),
    billingYear: integer('billing_year'),
    dueDate: date('due_date').notNull(),
    issueDate: date('issue_date').notNull().defaultNow(),
    /** Sum of the line items before concessions. */
    subtotal: numeric('subtotal', { precision: 12, scale: 2 }).notNull(),
    concessionAmount: numeric('concession_amount', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    lateFeeAmount: numeric('late_fee_amount', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    /** subtotal - concession + late fee. What the parent owes. */
    totalAmount: numeric('total_amount', { precision: 12, scale: 2 }).notNull(),
    /** Kept in step with `fee_payments` by the payment endpoint. */
    paidAmount: numeric('paid_amount', { precision: 12, scale: 2 })
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
    // What makes a re-run of bulk generation skip rather than duplicate.
    uniqueIndex('fee_challans_student_month_year_idx').on(
      table.studentProfileId,
      table.billingMonth,
      table.billingYear,
      table.academicYearId,
    ),
    check('fee_challans_billing_month_check', sql`${table.billingMonth} BETWEEN 1 AND 12`),
    check(
      'fee_challans_status_check',
      sql`${table.status} IN ('unpaid', 'partial', 'paid', 'cancelled', 'waived')`,
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
