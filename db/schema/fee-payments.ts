import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { feeChallans } from './fee-challans';
import { schools } from './schools';

export const PAYMENT_METHODS = ['cash', 'bank_transfer', 'cheque'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
  cheque: 'Cheque',
};

/**
 * fee_payments — money actually received against a challan.
 *
 * Append-only in practice: a payment is a record of something that happened at
 * a counter or a bank, so a mistake is corrected by recording a reversal, not
 * by editing history. Partial payments are ordinary — a family paying half in
 * the first week and half in the third produces two rows against one challan,
 * which is why the challan carries a running `paid_amount` rather than a
 * boolean.
 *
 * There is no payment gateway. Every row here was entered by a member of staff,
 * and `collected_by_uid` records which one — the only audit trail there is when
 * cash crosses a desk.
 */
export const feePayments = pgTable(
  'fee_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    challanId: uuid('challan_id')
      .notNull()
      .references(() => feeChallans.id, { onDelete: 'cascade' }),
    amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
    paymentMethod: text('payment_method').notNull().$type<PaymentMethod>(),
    /** Cheque number, bank transfer reference, deposit slip number. */
    referenceNumber: text('reference_number'),
    paymentDate: date('payment_date').notNull().defaultNow(),
    /** Firebase uid of the staff member who took the money. */
    collectedByUid: text('collected_by_uid').notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('fee_payments_location_id_idx').on(table.locationId),
    index('fee_payments_challan_id_idx').on(table.challanId),
    index('fee_payments_location_id_payment_date_idx').on(
      table.locationId,
      table.paymentDate,
    ),
    check(
      'fee_payments_payment_method_check',
      sql`${table.paymentMethod} IN ('cash', 'bank_transfer', 'cheque')`,
    ),
    check('fee_payments_amount_check', sql`${table.amount} > 0`),
  ],
);

export type FeePayment = typeof feePayments.$inferSelect;
export type NewFeePayment = typeof feePayments.$inferInsert;

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return (
    typeof value === 'string' && (PAYMENT_METHODS as readonly string[]).includes(value)
  );
}
