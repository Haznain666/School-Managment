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
  uuid,
} from 'drizzle-orm/pg-core';

import { academicYears } from './academic-years';
import { schools } from './schools';
import { studentGuardians } from './student-guardians';

export const FAMILY_CHALLAN_STATUSES = [
  'unpaid',
  'partial',
  'paid',
  'cancelled',
] as const;
export type FamilyChallanStatus = (typeof FAMILY_CHALLAN_STATUSES)[number];

export const FAMILY_CHALLAN_STATUS_LABELS: Record<FamilyChallanStatus, string> = {
  unpaid: 'Unpaid',
  partial: 'Partially paid',
  paid: 'Paid',
  cancelled: 'Cancelled',
};

/**
 * family_challans — one voucher covering the siblings of one guardian.
 *
 * A parent with three children at the school currently receives three slips,
 * queues three times and pays three amounts. This is the competitor's "Parent
 * Voucher" and it is the cheapest thing on this sprint, because
 * `student_guardians` already carries the grouping key.
 *
 * ── Why this is a real object and not a print view ───────────────────────
 * The obvious cheaper design is a print page that sums a guardian's open
 * challans and draws one sheet. It fails at the counter: the bank reconciles
 * against a challan number, and a sheet whose number belongs to nothing cannot
 * be matched to a payment. So a family voucher gets its own number from the
 * same issuer, and the child challans point at it.
 *
 * ── The per-student challans still exist, and that is deliberate ─────────
 * Every child keeps their own `fee_challans` row: fee reports, defaulter
 * lists, concessions and a student's own ledger are all per student, and a
 * family voucher is a *payment convenience*, not a change to who is billed.
 * The family row carries the total and the payment; the child rows carry the
 * detail and stay the authority on what each child owes.
 *
 * The consequence to hold onto: **a payment against a family voucher has to be
 * distributed across its members**, and `lib/family-challans.ts` owns that
 * arithmetic so the two never drift. Oldest challan first, so a part payment
 * clears the longest-standing debt — which is what a school does by hand.
 *
 * ── Cancelled, not deleted ──────────────────────────────────────────────
 * Cancelling releases the members back to being billed individually. There is
 * no `waived` status here on purpose: a waiver is a decision about one child's
 * fees and belongs on that child's challan, where the concession is recorded.
 */
export const familyChallans = pgTable(
  'family_challans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The tenant key — see STATE.md §1. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    /**
     * The guardian the voucher is addressed to.
     *
     * A guardian row belongs to one student, so the "family" is every student
     * whose guardian shares this row's phone number — see
     * `lib/family-challans.ts`, which resolves the group. The row recorded here
     * is the one whose name and address the voucher is printed with.
     */
    guardianId: uuid('guardian_id')
      .notNull()
      .references(() => studentGuardians.id, { onDelete: 'cascade' }),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYears.id),
    /** `GVS-F-2025-07-0001`. Unique across the platform, like a challan. */
    challanNumber: text('challan_number').notNull().unique(),
    /** 1–12. Null for a one-off voucher not tied to a month. */
    billingMonth: integer('billing_month'),
    billingYear: integer('billing_year'),
    dueDate: date('due_date').notNull(),
    issueDate: date('issue_date').notNull().defaultNow(),
    /** Sum of the member challans' `total_amount`, frozen at generation. */
    totalAmount: numeric('total_amount', { precision: 12, scale: 2 }).notNull(),
    /** Kept in step with the members by `lib/family-challans.ts`. */
    paidAmount: numeric('paid_amount', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    status: text('status').notNull().default('unpaid').$type<FamilyChallanStatus>(),
    notes: text('notes'),
    /** Supabase auth id of whoever generated it. */
    generatedByUid: text('generated_by_uid'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('family_challans_location_id_idx').on(table.locationId),
    index('family_challans_guardian_id_idx').on(table.guardianId),
    index('family_challans_location_status_idx').on(table.locationId, table.status),
    index('family_challans_location_due_date_idx').on(table.locationId, table.dueDate),
    check(
      'family_challans_status_check',
      sql`${table.status} IN ('unpaid', 'partial', 'paid', 'cancelled')`,
    ),
  ],
);

export type FamilyChallan = typeof familyChallans.$inferSelect;
