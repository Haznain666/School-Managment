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
 * There is no payment gateway (Sprint 5, Decision 3): every row here is
 * recorded by a member of staff who has seen the cash, the deposit slip or the
 * cheque, which is why `collected_by_uid` is mandatory. It is the audit trail
 * for a manual process, so rows are append-only — a mistaken entry is
 * corrected by a note and a compensating record, never by editing history.
 *
 * `fee_challans.paid_amount` is the running total of these rows and is updated
 * in the same batch that inserts one.
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
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    paymentMethod: text('payment_method').notNull().$type<PaymentMethod>(),
    /** Deposit slip, transaction id or cheque number. */
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
    check('fee_payments_amount_check', sql`${table.amount} > 0`),
    check(
      'fee_payments_payment_method_check',
      sql`${table.paymentMethod} IN ('cash', 'bank_transfer', 'cheque')`,
    ),
  ],
);

export type FeePayment = typeof feePayments.$inferSelect;
export type NewFeePayment = typeof feePayments.$inferInsert;

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return (
    typeof value === 'string' && (PAYMENT_METHODS as readonly string[]).includes(value)
  );
}
