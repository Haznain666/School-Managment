import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { payrollRuns } from './payroll-runs';
import { schoolUsers } from './school-users';
import { schools } from './schools';

export const PAYROLL_APPROVAL_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type PayrollApprovalStatus = (typeof PAYROLL_APPROVAL_STATUSES)[number];

export const PAYROLL_APPROVAL_STATUS_LABELS: Record<PayrollApprovalStatus, string> = {
  pending: 'Awaiting',
  approved: 'Approved',
  rejected: 'Rejected',
};

/**
 * payroll_run_approvals — one principal's signature over their slice of a run.
 *
 * ── Why a run has several of these and not one ───────────────────────────
 * The requirement, exactly: *only teachers' and coordinators' payroll comes to
 * the principal. A principal assigned a whole campus approves every teacher and
 * coordinator at it. Where a school runs several principals, each approves
 * those that fall under their own grades.*
 *
 * So approval is not a boolean on the run. It is **per head, over a slice**,
 * and the run advances only when every slice is signed. A single
 * `approved_by` column — which `payroll_runs` still carries, for the school
 * whose one administrator signs the whole thing — cannot express a Junior
 * School head who has approved her forty teachers while the Senior School head
 * has not looked yet.
 *
 * `staff_count` is that slice's size, frozen when the row is written. It is
 * what the screen says beside a head's name — *"38 staff, PKR 2,140,000"* — and
 * recomputing it on read would make a run's history move when an assignment
 * changes, which is exactly the property a signature must not have.
 *
 * ── `note`, and why a rejection has to be able to say why ────────────────
 * A rejected run goes back to `draft` and somebody has to fix something. "The
 * Principal rejected it" is not information; "Miss Sana's three days were
 * marked absent but she was at the board meeting" is. The column is nullable
 * because an approval usually has nothing to add.
 *
 * ── Unique on (run, principal) ───────────────────────────────────────────
 * One signature per head per run. Re-submitting a rejected run clears these
 * rows and writes them again, so a second submission is a clean sheet rather
 * than a half-signed one carrying somebody's stale approval of numbers that
 * have since changed.
 */
export const payrollRunApprovals = pgTable(
  'payroll_run_approvals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The tenant key — see STATE.md §1. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    payrollRunId: uuid('payroll_run_id')
      .notNull()
      .references(() => payrollRuns.id, { onDelete: 'cascade' }),
    /**
     * The head this slice belongs to.
     *
     * Cascade on delete: a person removed from the school cannot be waiting to
     * sign anything, and leaving an orphan row would freeze a run behind
     * somebody who no longer exists.
     */
    principalUserId: uuid('principal_user_id')
      .notNull()
      .references(() => schoolUsers.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('pending').$type<PayrollApprovalStatus>(),
    /** How many of the run's payslips this head covers. Frozen at submission. */
    staffCount: integer('staff_count').notNull().default(0),
    note: text('note'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('payroll_run_approvals_location_idx').on(table.locationId),
    index('payroll_run_approvals_principal_idx').on(
      table.locationId,
      table.principalUserId,
      table.status,
    ),
    uniqueIndex('payroll_run_approvals_run_principal_idx').on(
      table.payrollRunId,
      table.principalUserId,
    ),
    check(
      'payroll_run_approvals_status_check',
      sql`${table.status} IN ('pending', 'approved', 'rejected')`,
    ),
  ],
);

export type PayrollRunApproval = typeof payrollRunApprovals.$inferSelect;
export type NewPayrollRunApproval = typeof payrollRunApprovals.$inferInsert;
