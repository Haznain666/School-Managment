import {
  clampPaise,
  formatPkr,
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
  /**
   * The single head a pre-Sprint-18 grant was narrowed to. Null = every head.
   *
   * Still read, never backfilled. `concessionHeads` below folds it into the
   * set, so a row written in Sprint 5 prices exactly as it always did.
   */
  appliesToFeeTypeId: string | null;
  /**
   * The heads this concession is narrowed to (Sprint 18).
   *
   * **`null` and `[]` both mean every head, of every category**, and that is
   * not a shortcut — it is the rule. See `concessionHeads`.
   */
  appliesToFeeTypeIds?: readonly string[] | null | undefined;
}

/**
 * The heads a concession applies to, or `null` for "all of them".
 *
 * ── Read this before narrowing anything here ─────────────────────────────
 * An empty set is the **wide** case. A school that writes "20% sibling
 * discount" with no qualifier means every fee the child is charged, and until
 * Sprint 17 this function's ancestor read the unqualified case as "monthly
 * heads only" — so the commonest discount in Pakistani schooling silently
 * never reached the admission, annual or examination fee. Nothing reported it,
 * because *a discount that does not apply is indistinguishable on screen from
 * a discount the school never granted*. STATE.md §5be calls it the one-line bug
 * that cost the most.
 *
 * Sprint 18 widened one head to a set, which is the same decision in a new
 * shape and the same trap: `[]` must not start meaning "nothing". Both the
 * scheme's head list and the grant's are optional narrowings, and both are
 * empty for the majority of real rows.
 */
function concessionHeads(concession: ConcessionInput): Set<string> | null {
  const heads = new Set<string>();

  for (const id of concession.appliesToFeeTypeIds ?? []) heads.add(id);
  if (concession.appliesToFeeTypeId !== null) heads.add(concession.appliesToFeeTypeId);

  return heads.size === 0 ? null : heads;
}

/**
 * How one concession reads on a voucher line — `Sibling Discount 20%`.
 *
 * A percentage is printed as the rate rather than as the rupees it produced,
 * because the rupees are already in the Concession column beside it and the
 * rate is the fact that column cannot carry. A fixed discount prints its
 * amount, which is the same reasoning: `Staff Discount PKR 2,000` says what the
 * school granted, not what happened to fit on this line.
 */
function describeConcession(concession: ConcessionInput): string {
  if (concession.discountType === 'percentage') {
    const percent = Number(concession.discountValue ?? 0);
    const rendered = Number.isInteger(percent) ? String(percent) : percent.toFixed(2);
    return `${concession.concessionName} ${rendered}%`;
  }

  return `${concession.concessionName} ${formatPkr(concession.discountValue)}`;
}

/** One line of a challan, ready to insert. All amounts are PKR strings. */
export interface ChallanItem {
  feeTypeId: string;
  description: string;
  amount: string;
  concessionAmount: string;
  netAmount: string;
  /**
   * The concessions that produced `concessionAmount`, named and rated (Sprint
   * 18). Null when none applied, which is most lines.
   */
  concessionDetail: string | null;
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
): { applied: number; excess: number; detail: string | null } {
  let total = 0;
  const applying: string[] = [];

  for (const concession of concessions) {
    const heads = concessionHeads(concession);
    // `null` is "every head", and it is the common case. See `concessionHeads`.
    const matches = heads === null ? true : heads.has(line.feeTypeId);

    if (!matches) continue;

    applying.push(describeConcession(concession));

    total +=
      concession.discountType === 'percentage'
        ? percentOfPaise(line.amountPaise, Number(concession.discountValue ?? 0))
        : toPaise(concession.discountValue);
  }

  const applied = clampPaise(total, 0, line.amountPaise);
  // Named even when the clamp took the figure to zero: "Sibling Discount 100%"
  // against a line reading nil is the explanation of the nil, and the line a
  // parent would otherwise ring about.
  const detail = applying.length === 0 ? null : applying.join(', ');

  /*
   * What the clamp threw away, reported rather than discarded.
   *
   * ── The defect this closes ───────────────────────────────────────────
   * The clamp itself is right: a fee head may never go negative, or a challan
   * line becomes a refund. But the excess used to stop here, and QA found what
   * that cost — a fixed discount of 60,000 against a 50,000 admission fee
   * floored the voucher at zero and the remaining 10,000 simply ceased to
   * exist. The school believed it had granted 60,000 of relief and the parent
   * received 50,000 of it, with nothing anywhere recording the difference.
   *
   * The product owner's rule is explicit: if the discount is more than the fee,
   * the remainder carries forward to the next voucher. It cannot carry forward
   * if this function is the last thing that knows about it.
   */
  return { applied, excess: Math.max(0, total - applied), detail };
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
/** Lines, plus the discount that had nowhere to go on any of them. */
export interface ChallanLines {
  items: ChallanItem[];
  /**
   * Discount the per-line clamp could not apply, in paise.
   *
   * Becomes a `discount_overflow` credit on the student, which the next voucher
   * spends as an Adjustment. Zero in every ordinary case.
   */
  overflowPaise: number;
}

/**
 * Builds the line items **and** reports the discount that overflowed them.
 *
 * `calculateChallanItems` is this function with the overflow dropped, kept
 * because most callers only want the lines. Anything that *writes* a challan
 * must use this one instead: dropping the overflow at a write site is how the
 * carry-forward silently stops happening.
 */
export function calculateChallanLines(
  feeStructures: readonly FeeStructureInput[],
  concessions: readonly ConcessionInput[],
  billingMonth?: number | undefined,
): ChallanLines {
  const billable =
    billingMonth === undefined
      ? feeStructures
      : feeStructures.filter((structure) => structure.feeCategory === 'monthly');

  let overflowPaise = 0;

  const items = [...billable]
    .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
    .map((structure) => {
      const amountPaise = toPaise(structure.amount);
      const { applied, excess, detail } = concessionPaiseFor(
        {
          feeTypeId: structure.feeTypeId,
          feeCategory: structure.feeCategory,
          amountPaise,
        },
        concessions,
      );

      overflowPaise += excess;

      return {
        feeTypeId: structure.feeTypeId,
        description: structure.description,
        amount: paiseToNumeric(amountPaise),
        concessionAmount: paiseToNumeric(applied),
        netAmount: paiseToNumeric(amountPaise - applied),
        concessionDetail: detail,
      };
    });

  return { items, overflowPaise };
}

export function calculateChallanItems(
  feeStructures: readonly FeeStructureInput[],
  concessions: readonly ConcessionInput[],
  billingMonth?: number | undefined,
): ChallanItem[] {
  return calculateChallanLines(feeStructures, concessions, billingMonth).items;
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
