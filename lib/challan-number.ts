import 'server-only';

import { sql } from 'drizzle-orm';

import { challanSequences } from '@/db/schema';

import type { Database } from './drizzle';
import { normalizeSchoolCode } from './school-code';

/**
 * Challan number issuing — `GVS-2025-07-0001` (Sprint 5).
 *
 * ── On atomicity ─────────────────────────────────────────────────────────
 * A bulk run raises hundreds of challans in a few seconds, and two clerks may
 * start one at the same moment. `fee_challans.challan_number` is uniquely
 * indexed, so a collision does not produce a duplicate — it produces a failed
 * generation halfway through a grade.
 *
 * The increment is therefore a single `INSERT ... ON CONFLICT DO UPDATE ...
 * RETURNING`. Postgres runs each statement in its own transaction and takes a
 * row lock on conflict, so the second writer waits for the first to commit and
 * then reads the incremented value. A read-then-write across two round trips
 * would be exactly the race this avoids: wrapping the pair in a transaction
 * would not close it either, since neither statement takes a lock the other
 * would have to wait behind.
 */

/** Raised when a challan number cannot be issued. Blocks generation — it must. */
export class ChallanNumberError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChallanNumberError';
  }
}

/** `GVS`, 2025, 7, 1 -> `GVS-2025-07-0001`. */
export function formatChallanNumber(
  schoolCode: string,
  billingYear: number,
  billingMonth: number,
  sequence: number,
): string {
  const month = String(billingMonth).padStart(2, '0');
  return `${schoolCode}-${billingYear}-${month}-${String(sequence).padStart(4, '0')}`;
}

/**
 * Issues the next challan number for a school and billing period.
 *
 * @param locationId  Tenant key, always from verified claims.
 * @param schoolCode  From `schools.school_code`, e.g. `GVS`.
 * @throws {ChallanNumberError} when the school has no usable code, or the
 *   counter could not be reserved.
 */
export async function generateChallanNumber(
  db: Database,
  locationId: string,
  schoolCode: string,
  billingMonth: number,
  billingYear: number,
): Promise<string> {
  const code = normalizeSchoolCode(schoolCode);
  if (code === '') {
    throw new ChallanNumberError(
      'This school has no school code set. Add one in the Super Admin panel before generating vouchers.',
    );
  }

  if (!Number.isInteger(billingMonth) || billingMonth < 1 || billingMonth > 12) {
    throw new ChallanNumberError('The billing month must be between 1 and 12.');
  }

  if (!Number.isInteger(billingYear) || billingYear < 2000 || billingYear > 2100) {
    throw new ChallanNumberError('The billing year must be between 2000 and 2100.');
  }

  const rows = await db
    .insert(challanSequences)
    .values({ locationId, billingMonth, billingYear, lastSequence: 1 })
    .onConflictDoUpdate({
      target: [
        challanSequences.locationId,
        challanSequences.billingMonth,
        challanSequences.billingYear,
      ],
      set: { lastSequence: sql`${challanSequences.lastSequence} + 1` },
    })
    .returning({ lastSequence: challanSequences.lastSequence });

  const sequence = rows[0]?.lastSequence;
  if (sequence === undefined) {
    throw new ChallanNumberError('Could not reserve a voucher number. Please try again.');
  }

  return formatChallanNumber(code, billingYear, billingMonth, sequence);
}

/**
 * Reserves a block of consecutive numbers in one statement.
 *
 * Bulk generation needs four hundred numbers; taking them one at a time would
 * be four hundred round trips to Postgres. Advancing the counter by `count` once
 * and slicing the reserved range locally is the same guarantee at one
 * round trip — the range is exclusively ours the moment the statement commits.
 */
export async function reserveChallanNumbers(
  db: Database,
  locationId: string,
  schoolCode: string,
  billingMonth: number,
  billingYear: number,
  count: number,
): Promise<string[]> {
  if (count <= 0) return [];

  const code = normalizeSchoolCode(schoolCode);
  if (code === '') {
    throw new ChallanNumberError(
      'This school has no school code set. Add one in the Super Admin panel before generating vouchers.',
    );
  }

  const rows = await db
    .insert(challanSequences)
    .values({ locationId, billingMonth, billingYear, lastSequence: count })
    .onConflictDoUpdate({
      target: [
        challanSequences.locationId,
        challanSequences.billingMonth,
        challanSequences.billingYear,
      ],
      set: { lastSequence: sql`${challanSequences.lastSequence} + ${count}` },
    })
    .returning({ lastSequence: challanSequences.lastSequence });

  const last = rows[0]?.lastSequence;
  if (last === undefined) {
    throw new ChallanNumberError('Could not reserve voucher numbers. Please try again.');
  }

  // `last` is the highest number in our block; the block starts count-1 below it.
  const first = last - count + 1;

  return Array.from({ length: count }, (_unused, offset) =>
    formatChallanNumber(code, billingYear, billingMonth, first + offset),
  );
}
