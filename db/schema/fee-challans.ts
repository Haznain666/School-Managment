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
import { familyChallans } from './family-challans';
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
 * The kinds of challan the database itself has a rule about.
 *
 * There is exactly one, and adding a second should be resisted unless it comes
 * with a constraint that needs it — see the column's comment below. A kind that
 * only labels a bill belongs nowhere near a unique index.
 */
export const CHALLAN_KINDS = ['admission'] as const;
export type ChallanKind = (typeof CHALLAN_KINDS)[number];

/**
 * What kind of voucher the register is showing.
 *
 * A *presentation* distinction rather than a column: `monthly` is a voucher
 * with a billing month, `one_off` is one without and without a kind, and
 * `admission` is `challan_kind = 'admission'` — the only kind the database
 * itself has a rule about. Adding a fourth here should mean adding a constraint
 * that needs it; see `db/schema/fee-challans.ts`.
 */
export const CHALLAN_KIND_FILTERS = ['monthly', 'one_off', 'admission'] as const;
export type ChallanKindFilter = (typeof CHALLAN_KIND_FILTERS)[number];

export const CHALLAN_KIND_FILTER_LABELS: Record<ChallanKindFilter, string> = {
  monthly: 'Monthly',
  one_off: 'One-off',
  admission: 'Admission',
};

export function isChallanKindFilter(value: unknown): value is ChallanKindFilter {
  return (
    typeof value === 'string' &&
    (CHALLAN_KIND_FILTERS as readonly string[]).includes(value)
  );
}

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
    /**
     * Credit carried forward that this challan spent (Sprint 17).
     *
     * On the header rather than in `fee_challan_items` because every line there
     * carries a `fee_type_id NOT NULL`, and an adjustment has no fee head: it
     * is not a charge the school levied, it is money the school already owed.
     * Frozen at generation exactly as `subtotal` and `concession_amount` are.
     *
     * The consuming `student_credits` row is written in the same `batch()` as
     * the challan. A credit spent by a challan that was not written is a credit
     * lost, and nothing would ever report it missing.
     */
    creditApplied: numeric('credit_applied', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    /** subtotal - concession - credit applied + late fee. What the parent owes. */
    totalAmount: numeric('total_amount', { precision: 12, scale: 2 }).notNull(),
    /** Kept in step with `fee_payments` by the payment endpoint. */
    paidAmount: numeric('paid_amount', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    status: text('status').notNull().default('unpaid').$type<ChallanStatus>(),
    /**
     * What kind of bill this is, when it is a kind the database has to police.
     *
     * Null for every ordinary challan — monthly, annual, and the one-off bills
     * a school raises by hand — and that is the overwhelming majority. It is
     * deliberately not a general taxonomy: the column exists because of one
     * rule that could not otherwise be enforced.
     *
     * ── The race it closes ───────────────────────────────────────────────
     * "One admission, one admission fee" was a read followed by an insert:
     * `generateAdmissionChallan` asked `resolveAdmissionFee` whether a voucher
     * already existed and raised one if not. Two clicks — a double-click, two
     * tabs, a retried request — both pass that read and both insert, and the
     * unique index that catches this for a monthly challan cannot: an
     * admission voucher carries a **null** `billing_month`, and Postgres treats
     * nulls as distinct. The result is two vouchers for one admission, and,
     * worse, the student's carried-forward credit spent twice.
     *
     * That is CLAUDE.md's background-work rule in a different costume, and it
     * has the same answer: let Postgres decide it on one row under one lock.
     * `fee_challans_admission_once_idx` below is that decision.
     */
    challanKind: text('challan_kind').$type<ChallanKind>(),
    /**
     * Set when this challan has been folded into a family voucher (Sprint 10).
     *
     * The challan is still the authority on what this child owes — reports,
     * defaulter lists and concessions all read it, and none of them know or
     * care about the voucher. What the link changes is where the *payment*
     * arrives: `lib/family-challans.ts` distributes one family payment across
     * the members, so this row must not also be paid directly.
     *
     * `set null` on delete, so cancelling a voucher releases its members back
     * to being billed individually rather than taking them with it.
     */
    familyChallanId: uuid('family_challan_id').references(() => familyChallans.id, {
      onDelete: 'set null',
    }),
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
    index('fee_challans_family_challan_id_idx').on(table.familyChallanId),
    // What makes a re-run of bulk generation skip rather than duplicate.
    uniqueIndex('fee_challans_student_month_year_idx').on(
      table.studentProfileId,
      table.billingMonth,
      table.billingYear,
      table.academicYearId,
    ),
    /*
     * One live admission voucher per student per year, decided by Postgres.
     *
     * Partial on `challan_kind = 'admission'`, so it constrains nothing else —
     * a school may still raise as many one-off challans as it likes, which is
     * what the null `billing_month` in the index above exists to allow.
     *
     * Partial on `status <> 'cancelled'` as well, because cancelling a voucher
     * has to make room for the corrected one. A `waived` voucher deliberately
     * does *not* make room: waiving is a decision a human made that settles the
     * admission, and re-billing it would undo that decision silently.
     */
    uniqueIndex('fee_challans_admission_once_idx')
      .on(table.studentProfileId, table.academicYearId)
      .where(sql`${table.challanKind} = 'admission' AND ${table.status} <> 'cancelled'`),
    check(
      'fee_challans_challan_kind_check',
      sql`${table.challanKind} IS NULL OR ${table.challanKind} IN ('admission')`,
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
