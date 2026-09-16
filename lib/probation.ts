import { MAX_PROBATION_DAYS } from '@/db/schema/staff';

import { addDays } from './holiday-calendar';

/**
 * `lib/probation.ts` — the 180-day ceiling, and nothing else. Sprint 33b,
 * decision 4.
 *
 * ── Calendar days, holidays included ─────────────────────────────────────
 * *"180 is the total length, counted in plain calendar days including
 * holidays. An extension may not push past it."* That is the product owner's
 * wording and it is also how a labour contract is written, so there is
 * deliberately no working-day arithmetic here: a probation that ran 180
 * *working* days would be nearly nine months, and nobody signing the contract
 * would read it that way.
 *
 * ── The extension is part of the total, not on top of it ─────────────────
 * `probation_days + probation_extended_days <= 180`. The API refuses a longer
 * total and `staff_probation_days_check` refuses it again in the database,
 * because a ceiling enforced only by a route is one the next route forgets.
 *
 * Free of `server-only` and of any query, like `lib/leave-quota.ts` beside it:
 * the HR form computes the end date as the clerk types and the route computes
 * it again on the write, from this function.
 */

export { MAX_PROBATION_DAYS };

/**
 * The day probation ends, inclusive of the start.
 *
 * Day 1 is `startedOn` itself, so 180 days beginning on 1 January ends on 29
 * June and not on 30 June. Off-by-one here is a day of somebody's employment
 * status, which is the kind of thing an employment tribunal asks about.
 */
export function probationEndDate(
  startedOn: string,
  days: number,
  extendedDays = 0,
): string | null {
  const total = days + extendedDays;
  if (!Number.isInteger(total) || total < 1) return null;
  if (Number.isNaN(Date.parse(`${startedOn}T00:00:00Z`))) return null;

  return addDays(startedOn, total - 1);
}

export interface ProbationInput {
  isOnProbation: boolean;
  startedOn: string | null;
  days: number | null;
  extendedDays: number;
}

/** Why this probation cannot be recorded, or null. */
export function probationProblem(input: ProbationInput): string | null {
  if (!input.isOnProbation) return null;

  if (input.startedOn === null || Number.isNaN(Date.parse(`${input.startedOn}T00:00:00Z`))) {
    return 'Enter the date probation started.';
  }

  if (input.days === null || !Number.isInteger(input.days) || input.days < 1) {
    return 'Enter how many days the probation runs for.';
  }

  if (!Number.isInteger(input.extendedDays) || input.extendedDays < 0) {
    return 'An extension is a whole number of days, or none at all.';
  }

  const total = input.days + input.extendedDays;
  if (total > MAX_PROBATION_DAYS) {
    return input.extendedDays > 0
      ? `Probation cannot run longer than ${String(MAX_PROBATION_DAYS)} calendar days in total, and ${String(input.days)} plus an extension of ${String(input.extendedDays)} is ${String(total)}.`
      : `Probation cannot run longer than ${String(MAX_PROBATION_DAYS)} calendar days.`;
  }

  return null;
}

/**
 * Days left of a probation as of `today`, or null when it is not running.
 *
 * Negative is clamped to 0: a probation that ended yesterday has nothing left,
 * and the sweep that tells HR reads `probation_ends_on` directly rather than
 * this.
 */
export function probationDaysLeft(endsOn: string | null, today: string): number | null {
  if (endsOn === null) return null;

  const end = Date.parse(`${endsOn}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(end) || Number.isNaN(now)) return null;

  return Math.max(0, Math.round((end - now) / 86_400_000));
}
