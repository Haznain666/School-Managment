import 'server-only';

import { sql } from 'drizzle-orm';

import { payslipSequences } from '@/db/schema';

import type { Database } from './drizzle';
import { normalizeSchoolCode } from './school-code';

/**
 * Payslip number issuing — `GVS-PS-2025-07-0001` (Sprint 7).
 *
 * The same design as `lib/challan-number.ts`, and for the same reason:
 * `payslips.payslip_number` is uniquely indexed, a run raises one number per
 * staff member in a single pass, and two administrators may start the same
 * month's run at the same moment. A collision would not produce a duplicate —
 * it would produce a run that failed halfway through, leaving some staff with
 * payslips and some without.
 *
 * The increment is therefore a single `INSERT ... ON CONFLICT DO UPDATE ...
 * RETURNING`. Postgres runs each statement in its own transaction and takes a
 * row lock on conflict, so the second writer waits and then reads the
 * incremented value. A read-then-write across two round trips would be exactly
 * the race this avoids, and could not be closed by a transaction anyway — the
 * Neon HTTP driver has no interactive ones.
 *
 * The `PS` infix keeps a payslip number visibly different from a challan
 * number. Both are quoted at a bank counter, and a clerk handed `GVS-2025-07-
 * 0001` should not have to guess which one it is.
 */

/** Raised when a payslip number cannot be issued. Blocks a run — it must. */
export class PayslipNumberError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayslipNumberError';
  }
}

/** `GVS`, 2025, 7, 1 -> `GVS-PS-2025-07-0001`. */
export function formatPayslipNumber(
  schoolCode: string,
  payrollYear: number,
  payrollMonth: number,
  sequence: number,
): string {
  const month = String(payrollMonth).padStart(2, '0');
  return `${schoolCode}-PS-${payrollYear}-${month}-${String(sequence).padStart(4, '0')}`;
}

/**
 * Reserves a block of consecutive payslip numbers in one statement.
 *
 * A run needs one number per staff member; taking them one at a time would be
 * one round trip to Neon each. Advancing the counter by `count` once and
 * slicing the reserved range locally is the same guarantee at one round trip —
 * the range is exclusively ours the moment the statement commits.
 *
 * @param locationId  Tenant key, always from verified claims.
 * @param schoolCode  From `schools.school_code`, e.g. `GVS`.
 * @throws {PayslipNumberError} when the school has no usable code, the period
 *   is out of range, or the counter could not be reserved.
 */
export async function reservePayslipNumbers(
  database: Database,
  locationId: string,
  schoolCode: string,
  payrollMonth: number,
  payrollYear: number,
  count: number,
): Promise<string[]> {
  if (count <= 0) return [];

  const code = normalizeSchoolCode(schoolCode);
  if (code === '') {
    throw new PayslipNumberError(
      'This school has no school code set. Add one in the Super Admin panel before running payroll.',
    );
  }

  if (!Number.isInteger(payrollMonth) || payrollMonth < 1 || payrollMonth > 12) {
    throw new PayslipNumberError('The payroll month must be between 1 and 12.');
  }

  if (!Number.isInteger(payrollYear) || payrollYear < 2000 || payrollYear > 2100) {
    throw new PayslipNumberError('The payroll year must be between 2000 and 2100.');
  }

  const rows = await database
    .insert(payslipSequences)
    .values({ locationId, payrollMonth, payrollYear, lastSequence: count })
    .onConflictDoUpdate({
      target: [
        payslipSequences.locationId,
        payslipSequences.payrollMonth,
        payslipSequences.payrollYear,
      ],
      set: { lastSequence: sql`${payslipSequences.lastSequence} + ${count}` },
    })
    .returning({ lastSequence: payslipSequences.lastSequence });

  const last = rows[0]?.lastSequence;
  if (last === undefined) {
    throw new PayslipNumberError('Could not reserve payslip numbers. Please try again.');
  }

  // `last` is the highest number in our block; the block starts count-1 below it.
  const first = last - count + 1;

  return Array.from({ length: count }, (_unused, offset) =>
    formatPayslipNumber(code, payrollYear, payrollMonth, first + offset),
  );
}
