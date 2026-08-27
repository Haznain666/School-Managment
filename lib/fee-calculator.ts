import {
  clampPaise,
  paiseToNumeric,
  percentOfPaise,
  toPaise,
  type MoneyInput,
} from './money';

/**
 * Fee arithmetic — what a student owes, and what they owe on top for paying late.
 *
 * Pure functions with no database access, so both the challan endpoints and the
 * generation preview screen compute from exactly the same code. Every sum here
 * is in integer paise (see `lib/money.ts`); rupee strings go in and rupee
 * strings come out, and nothing in between is a float.
 */

/** A row of the price list, as the challan generator needs it. */
export interface FeeStructureInput {
  feeTypeId: string;
  /** The head's name, copied onto the challan line. */
  description: string;
  feeCategory: string;
  /** PKR, as stored. */
  amount: MoneyInput;
  sortOrder?: number | undefined;
}

/** An active concession for the student being billed. */
export interface ConcessionInput {
  id: string;
  concessionName: string;
  discountType: string;
  discountValue: MoneyInput;
  /** Null = applies to every head, of every category. */
  appliesToFeeTypeId: string | null;
}

/** One line of a challan, ready to insert. All amounts are PKR strings. */
export interface ChallanItem {
  feeTypeId: string;
  description: string;
  amount: string;
  concessionAmount: string;
  netAmount: string;
}

export interface ChallanTotals {
  items: ChallanItem[];
  subtotal: string;
  concessionAmount: string;
  /**
   * Credit carried forward that this challan spends (Sprint 17).
   *
   * Zero until `applyCreditToTotals` has run, which is the last step of both
   * `previewChallan` and `generateChallan`. It is not a line item: an
   * adjustment has no fee head, so it lives on the header.
   */
  creditApplied: string;
  /**
   * subtotal - concession - credit. The late fee is added separately, when
   * overdue.
   */
  totalAmount: string;
}

/**
 * The discount a set of concessions takes off one fee line, in paise.
 *
 * Concessions stack — a school may grant both a sibling discount and a staff
 * discount — but the result is clamped to the line's own amount, because a
 * concession may never turn a fee into a refund.
 *
 * A concession with a null `appliesToFeeTypeId` covers **every** head, of every
 * category; one naming a head applies only to that head. That is what a school
 * means when it writes "20% sibling discount" with no qualifier.
 *
 * Until Sprint 17 the null case was narrowed to `monthly` heads only, and it
 * cost real money in the wrong direction: LGS's sibling discount is exactly
 * that row — no head named, 20%, open-ended — so it could never reach the
 * admission fee, the annual fee or anything else one-time. Nothing reported
 * it, because a discount that does not apply looks identical to a discount the
 * school never granted. A school that wants a monthly-only discount names the
 * monthly head, which has always worked and is the narrower, explicit case.
 */
function concessionPaiseFor(
  line: { feeTypeId: string; feeCategory: string; amountPaise: number },
  concessions: readonly ConcessionInput[],
): number {
  let total = 0;

  for (const concession of concessions) {
    const matches =
      concession.appliesToFeeTypeId === null
        ? true
        : concession.appliesToFeeTypeId === line.feeTypeId;

    if (!matches) continue;

    total +=
      concession.discountType === 'percentage'
        ? percentOfPaise(line.amountPaise, Number(concession.discountValue ?? 0))
        : toPaise(concession.discountValue);
  }

  return clampPaise(total, 0, line.amountPaise);
}

/**
 * Builds the line items for a challan from the price list and the student's
 * concessions.
 *
 * @param feeStructures  Price-list rows for the student's grade and year. Pass
 *   everything that applies; the category filter below decides what is billed.
 * @param concessions  The student's concessions, already narrowed to those
 *   valid on the billing date — this function does not know today's date.
 * @param billingMonth  Set for a monthly run, in which case only `monthly`
 *   heads are billed. Leave undefined to bill every structure passed in, which
 *   is how admission and annual charges are raised.
 */
export function calculateChallanItems(
  feeStructures: readonly FeeStructureInput[],
  concessions: readonly ConcessionInput[],
  billingMonth?: number | undefined,
): ChallanItem[] {
  const billable =
    billingMonth === undefined
      ? feeStructures
      : feeStructures.filter((structure) => structure.feeCategory === 'monthly');

  return [...billable]
    .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
    .map((structure) => {
      const amountPaise = toPaise(structure.amount);
      const concessionPaise = concessionPaiseFor(
        {
          feeTypeId: structure.feeTypeId,
          feeCategory: structure.feeCategory,
          amountPaise,
        },
        concessions,
      );

      return {
        feeTypeId: structure.feeTypeId,
        description: structure.description,
        amount: paiseToNumeric(amountPaise),
        concessionAmount: paiseToNumeric(concessionPaise),
        netAmount: paiseToNumeric(amountPaise - concessionPaise),
      };
    });
}

/** Sums a set of lines into the totals a challan header carries. */
export function summariseChallanItems(items: readonly ChallanItem[]): ChallanTotals {
  let subtotalPaise = 0;
  let concessionPaise = 0;

  for (const item of items) {
    subtotalPaise += toPaise(item.amount);
    concessionPaise += toPaise(item.concessionAmount);
  }

  return {
    items: [...items],
    subtotal: paiseToNumeric(subtotalPaise),
    concessionAmount: paiseToNumeric(concessionPaise),
    creditApplied: paiseToNumeric(0),
    totalAmount: paiseToNumeric(subtotalPaise - concessionPaise),
  };
}

/**
 * Spends a student's carried-forward credit against a set of totals.
 *
 * The last step of pricing a challan, and deliberately separate from
 * `summariseChallanItems`: the credit is not a fee head and not a discount on
 * one, it is money the school already owes this child (see
 * `db/schema/student-credits.ts`). It reduces what the parent is asked for and
 * nothing else about the bill.
 *
 * Two floors, both of which matter:
 *
 *  * only as much credit as there is to demand is spent, so a 5,000 credit
 *    against a 1,200 voucher spends 1,200 and leaves 3,800 for the next one;
 *  * the total can never go below zero, which is what
 *    `fee_challans_*` and every reader of `total_amount` assume. A voucher for
 *    a negative amount is not a refund — it is a slip a bank teller cannot
 *    process and a parent cannot understand.
 *
 * @param availableCreditPaise  The student's `SUM(amount)` balance, in paise.
 *   Anything at or below zero spends nothing.
 */
export function applyCreditToTotals(
  totals: ChallanTotals,
  availableCreditPaise: number,
): ChallanTotals {
  const owedPaise = toPaise(totals.totalAmount);
  const spendablePaise = Math.max(Math.trunc(availableCreditPaise), 0);
  const appliedPaise = Math.min(spendablePaise, Math.max(owedPaise, 0));

  if (appliedPaise <= 0) return totals;

  return {
    ...totals,
    creditApplied: paiseToNumeric(appliedPaise),
    totalAmount: paiseToNumeric(owedPaise - appliedPaise),
  };
}

/** The school's overdue policy, as `calculateLateFee` needs it. */
export interface LateFeeRuleInput {
  isEnabled: boolean;
  graceDays: number;
  lateFeeType: string;
  lateFeeAmount: MoneyInput;
  /** Ceiling for a daily charge. Null = uncapped. */
  maxLateFee: MoneyInput;
}

/** Whole days between two dates, ignoring the time of day. */
function daysBetween(from: Date, to: Date): number {
  const startOfFrom = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const startOfTo = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.floor((startOfTo - startOfFrom) / 86_400_000);
}

/** Parses a `YYYY-MM-DD` column value as a local calendar date. */
export function parseDateOnly(value: string | Date): Date {
  if (value instanceof Date) return value;

  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

/**
 * What a challan owes in late fees, as a PKR number.
 *
 * Returns 0 when the school has no policy, has switched it off, or the challan
 * is still inside its grace period — the three cases where a school would be
 * rightly furious to find a charge on a parent's slip.
 *
 * A `fixed` rule charges its amount once, the moment grace runs out. A `daily`
 * rule charges per day *past* grace, capped by `maxLateFee` when one is set.
 *
 * @param asOf  Defaults to now. Passed explicitly by reports so a whole page of
 *   challans is priced against one instant.
 */
export function calculateLateFee(
  dueDate: string | Date,
  rule: LateFeeRuleInput | null,
  asOf: Date = new Date(),
): number {
  if (rule === null || !rule.isEnabled) return 0;

  const amountPaise = toPaise(rule.lateFeeAmount);
  if (amountPaise <= 0) return 0;

  const graceDays = Number.isFinite(rule.graceDays) ? Math.max(rule.graceDays, 0) : 0;
  const daysOverdue = daysBetween(parseDateOnly(dueDate), asOf) - graceDays;

  if (daysOverdue <= 0) return 0;

  const chargedPaise =
    rule.lateFeeType === 'daily' ? amountPaise * daysOverdue : amountPaise;

  const capPaise = toPaise(rule.maxLateFee);
  const finalPaise =
    rule.maxLateFee === null || rule.maxLateFee === undefined || capPaise <= 0
      ? chargedPaise
      : Math.min(chargedPaise, capPaise);

  return finalPaise / 100;
}

/** Days past the due date, floored at 0. Drives the defaulters report. */
export function daysOverdue(dueDate: string | Date, asOf: Date = new Date()): number {
  return Math.max(daysBetween(parseDateOnly(dueDate), asOf), 0);
}

/**
 * The status a challan should now carry, given what has been paid.
 *
 * Cancelled and waived challans keep their status: they are decisions a human
 * made, and a late payment against one must not quietly reopen it.
 */
export function challanStatusFor(
  totalAmount: MoneyInput,
  paidAmount: MoneyInput,
  currentStatus: string,
): 'unpaid' | 'partial' | 'paid' | 'cancelled' | 'waived' {
  if (currentStatus === 'cancelled') return 'cancelled';
  if (currentStatus === 'waived') return 'waived';

  const totalPaise = toPaise(totalAmount);
  const paidPaise = toPaise(paidAmount);

  if (paidPaise <= 0) return 'unpaid';
  if (paidPaise >= totalPaise) return 'paid';
  return 'partial';
}

/** What is still owed on a challan, as a PKR number. */
export function remainingBalance(
  totalAmount: MoneyInput,
  paidAmount: MoneyInput,
): number {
  return Math.max(toPaise(totalAmount) - toPaise(paidAmount), 0) / 100;
}

/**
 * The default due date for a billing month: the 10th, or whatever day the
 * school has configured. Returned as `YYYY-MM-DD` for a DATE column.
 */
export function defaultDueDate(
  billingMonth: number,
  billingYear: number,
  dueDay = 10,
): string {
  const day = Math.min(Math.max(Math.trunc(dueDay), 1), 28);
  return `${billingYear}-${String(billingMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
