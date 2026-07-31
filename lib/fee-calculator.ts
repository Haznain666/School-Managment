import {
  atLeastZero,
  paiseOrZero,
  percentageOf,
  requirePaise,
  sumPaise,
  type Paise,
} from './money';

/**
 * Fee arithmetic — what a student owes, and what a late payment costs.
 *
 * Deliberately pure and dependency-free: no database, no `server-only`. The
 * generation wizard previews a challan in the browser and the API raises the
 * real one on the server, and both must produce identical numbers. Sharing one
 * implementation is the only way to guarantee that.
 *
 * Every amount here is integer paise. See `lib/money.ts` for why money never
 * becomes a JS float in this codebase.
 */

/** A fee structure row, as far as the calculator cares. */
export interface FeeStructureInput {
  feeTypeId: string;
  feeTypeName: string;
  /** NUMERIC string from the database. */
  amount: string;
  sortOrder: number;
}

/** A concession row, as far as the calculator cares. */
export interface ConcessionInput {
  discountType: 'percentage' | 'fixed';
  /** NUMERIC string: 0-100 for percentage, PKR for fixed. */
  discountValue: string;
  /** Null means the concession applies to tuition only. */
  appliesToFeeTypeId: string | null;
  /** `YYYY-MM-DD`. */
  validFrom: string;
  /** `YYYY-MM-DD`, or null for indefinite. */
  validUntil: string | null;
}

export interface ChallanItemCalculation {
  feeTypeId: string;
  description: string;
  /** Gross, in paise. */
  amount: Paise;
  concessionAmount: Paise;
  /** amount - concessionAmount, floored at zero. */
  netAmount: Paise;
}

export interface ChallanCalculation {
  items: ChallanItemCalculation[];
  subtotal: Paise;
  concessionTotal: Paise;
  /** subtotal - concessionTotal. Late fee is added separately, on payment. */
  total: Paise;
}

/**
 * Which fee head a concession with no explicit target applies to.
 *
 * A school granting "20% off" means off the tuition, not off the transport and
 * the exam fee as well. Matching on the name is crude, but the alternative —
 * a flag on `fee_types` — would be one more thing for a school to get wrong
 * during setup, and every school in this market calls it some form of tuition.
 */
function isTuition(feeTypeName: string): boolean {
  return /tuition/i.test(feeTypeName);
}

/** Inclusive date-window check against `YYYY-MM-DD` strings. */
function isConcessionActive(concession: ConcessionInput, onDate: string): boolean {
  if (concession.validFrom > onDate) return false;
  if (concession.validUntil !== null && concession.validUntil < onDate) return false;
  return true;
}

/** The first day of a billing month, as `YYYY-MM-DD`. */
export function billingPeriodStart(billingMonth: number, billingYear: number): string {
  return `${billingYear}-${String(billingMonth).padStart(2, '0')}-01`;
}

export interface CalculateChallanParams {
  feeStructures: readonly FeeStructureInput[];
  concessions: readonly ConcessionInput[];
  billingMonth: number;
  billingYear: number;
}

/**
 * Turns a grade's fee structure plus a student's concessions into challan
 * lines.
 *
 * Concessions are evaluated against the *first day of the billing month*
 * rather than today. Raising July's challans in August must apply July's
 * concessions, or a scholarship that lapsed in between would silently change
 * what a family was billed.
 *
 * A line's concession is capped at the line's own amount — a fixed PKR 5,000
 * discount against a PKR 3,000 fee zeroes it rather than producing a credit.
 * Refunds are not a thing this module does, and a negative line item on a
 * printed challan would be worse than the rounding it saves.
 */
export function calculateChallanItems(
  params: CalculateChallanParams,
): ChallanItemCalculation[] {
  const onDate = billingPeriodStart(params.billingMonth, params.billingYear);

  const active = params.concessions.filter((concession) =>
    isConcessionActive(concession, onDate),
  );

  const ordered = [...params.feeStructures].sort(
    (left, right) => left.sortOrder - right.sortOrder,
  );

  return ordered.map((structure) => {
    const amount = requirePaise(structure.amount);

    const applicable = active.filter((concession) =>
      concession.appliesToFeeTypeId === null
        ? isTuition(structure.feeTypeName)
        : concession.appliesToFeeTypeId === structure.feeTypeId,
    );

    // Several concessions on one head stack additively, then cap at the line
    // amount. Compounding them would make the order they were granted in
    // change the total, which no school would be able to explain to a parent.
    const discounts = applicable.map((concession) =>
      concession.discountType === 'percentage'
        ? percentageOf(amount, Number(concession.discountValue))
        : paiseOrZero(concession.discountValue),
    );

    const concessionAmount = Math.min(sumPaise(discounts), amount);

    return {
      feeTypeId: structure.feeTypeId,
      description: structure.feeTypeName,
      amount,
      concessionAmount,
      netAmount: atLeastZero(amount - concessionAmount),
    };
  });
}

/** Totals a set of calculated lines. */
export function summariseChallan(
  items: readonly ChallanItemCalculation[],
): ChallanCalculation {
  const subtotal = sumPaise(items.map((item) => item.amount));
  const concessionTotal = sumPaise(items.map((item) => item.concessionAmount));

  return {
    items: [...items],
    subtotal,
    concessionTotal,
    total: atLeastZero(subtotal - concessionTotal),
  };
}

// -----------------------------------------------------------------------------
// Late fees
// -----------------------------------------------------------------------------

export interface LateFeeRuleInput {
  isEnabled: boolean;
  graceDays: number;
  lateFeeType: 'fixed' | 'daily';
  /** NUMERIC string. */
  lateFeeAmount: string;
  /** NUMERIC string, or null for uncapped. */
  maxLateFee: string | null;
}

export interface CalculateLateFeeParams {
  /** `YYYY-MM-DD`. */
  dueDate: string;
  lateFeeRule: LateFeeRuleInput | null;
  /** `YYYY-MM-DD`. Defaults to today; injectable so it can be tested. */
  asOf?: string;
}

/** Whole days between two `YYYY-MM-DD` dates. Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  // Parsed as UTC midnight, so DST never shifts the difference.
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);

  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.round((end - start) / 86_400_000);
}

/** Today as `YYYY-MM-DD`, in UTC. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * What a challan's late fee stands at right now.
 *
 * Returns zero when the school has no rule, has it switched off, or the
 * challan is still inside its grace period — the common case, and the one
 * that must not cost a query.
 */
export function calculateLateFee(params: CalculateLateFeeParams): Paise {
  const rule = params.lateFeeRule;
  if (rule === null || !rule.isEnabled) return 0;

  const asOf = params.asOf ?? todayIso();
  const daysLate = daysBetween(params.dueDate, asOf) - Math.max(rule.graceDays, 0);

  if (daysLate <= 0) return 0;

  const unit = paiseOrZero(rule.lateFeeAmount);
  if (unit <= 0) return 0;

  const charged = rule.lateFeeType === 'daily' ? unit * daysLate : unit;

  const cap = rule.maxLateFee === null ? null : paiseOrZero(rule.maxLateFee);
  if (cap !== null && cap > 0) return Math.min(charged, cap);

  return charged;
}

/** How many days past due a challan is. Zero when it is not yet due. */
export function daysOverdue(dueDate: string, asOf?: string): number {
  return Math.max(daysBetween(dueDate, asOf ?? todayIso()), 0);
}
