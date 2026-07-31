import 'server-only';

import { sql } from 'drizzle-orm';

import { challanSequences } from '@/db/schema';

import type { Database } from './drizzle';
import { normalizeSchoolCode } from './school-code';

/**
 * Challan number issuing — `GVS-2025-07-0001`.
 *
 * ── On atomicity ─────────────────────────────────────────────────────────
 * Bulk generation raises four hundred challans in a loop, and
 * `fee_challans.challan_number` is globally unique — so a duplicate is not a
 * cosmetic problem, it is a failed generation partway through a run.
 *
 * The increment is a single `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`.
 * Postgres runs every statement in its own transaction and takes a row lock on
 * conflict, so a concurrent caller blocks until the first commits and then
 * reads the incremented value. A read-then-write across two round trips would
 * be exactly the race this avoids — and the Neon HTTP driver has no
 * interactive transactions to wrap one in anyway.
 */

export class ChallanNumberError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChallanNumberError';
  }
}

/** How many digits the sequence is padded to: `1` -> `0001`. */
const SEQUENCE_PAD = 4;

/**
 * Assembles the printed form.
 * Exported so a preview cannot drift from what is actually issued.
 */
export function formatChallanNumber(
  schoolCode: string,
  billingYear: number,
  billingMonth: number,
  sequence: number,
): string {
  const code = normalizeSchoolCode(schoolCode);
  const month = String(billingMonth).padStart(2, '0');
  const seq = String(sequence).padStart(SEQUENCE_PAD, '0');
  return `${code}-${billingYear}-${month}-${seq}`;
}

/**
 * Issues the next challan number for a school and billing period.
 *
 * @param locationId  Tenant key, always from verified claims.
 * @throws {ChallanNumberError} when the school has no usable code, or the
 *   period is out of range.
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
      'This school has no school code set, so challan numbers cannot be issued. Add one in the Super Admin panel.',
    );
  }

  if (!Number.isInteger(billingMonth) || billingMonth < 1 || billingMonth > 12) {
    throw new ChallanNumberError('Billing month must be between 1 and 12.');
  }

  if (!Number.isInteger(billingYear) || billingYear < 2000 || billingYear > 2100) {
    throw new ChallanNumberError('Billing year must be between 2000 and 2100.');
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
    throw new ChallanNumberError('Could not reserve a challan number. Please try again.');
  }

  return formatChallanNumber(code, billingYear, billingMonth, sequence);
}
