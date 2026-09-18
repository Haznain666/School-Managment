import 'server-only';

import type { ChallanPrintData } from '@/components/fees/ChallanPrintView';
import { PAYMENT_METHOD_LABELS } from '@/db/schema/fee-payments';

import { listVoucherBankAccounts } from './bank-accounts';
import { calculateLateFee, parseDateOnly } from './fee-calculator';
import type { ChallanDetail, LateFeeSettings } from './fee-queries';

/**
 * One read that assembles everything the printed voucher needs (Sprint 20,
 * item 11).
 *
 * ── Why this exists rather than three call sites building it ─────────────
 * Three screens print a voucher — the admin's detail page, the bulk print run
 * and the parent portal — and before this each of them spread `ChallanDetail`
 * into the print component by hand. Adding the bank block, the NTN and the
 * two totals to three spread expressions is three chances to miss one, and the
 * symptom is a parent holding a slip with no bank details while the school's
 * own copy has them.
 *
 * ── `VALID UPTO` ─────────────────────────────────────────────────────────
 * The due date plus the school's grace days where late fees are configured, and
 * the due date otherwise. That is the last day the amount on the left of the
 * table is actually what the parent owes, which is the only thing the line can
 * usefully mean.
 *
 * ── `TOTAL AMOUNT PAYABLE AFTER DUE DATE`, and when it is omitted ────────
 * Priced from the school's own rule at the first chargeable day — grace + one —
 * through `calculateLateFee`, so the figure on the slip is the figure the
 * module would charge and not a second implementation of the policy.
 *
 * **Omitted entirely when the school has no late fee configured.** A row saying
 * the two totals are equal teaches a parent that paying late costs nothing,
 * which is the opposite of what the row is for; and at a school with no policy
 * it happens to be true, which makes it worse rather than better.
 *
 * ── `VERSION` is always 1, and that is deliberate ────────────────────────
 * The product has no voucher versioning. The reference document has the field,
 * so it is printed; inventing a scheme to fill it would put a number on a slip
 * that changes meaning the first time somebody reprints one. See
 * `ChallanPrintView`.
 */
export async function buildVoucherPrintData(
  challan: ChallanDetail,
  options: {
    locationId: string;
    lateFeeRule: LateFeeSettings | null;
    logoUrl: string | null;
    /** Today, so a bulk run prices every slip against one instant. */
    asOf?: Date;
  },
): Promise<ChallanPrintData> {
  const { lateFeeRule } = options;

  /*
   * Only the accounts a parent should be paying into: active, student-facing,
   * and either this campus's or the school's. See `listVoucherBankAccounts` —
   * all three conditions are load-bearing and one of them is the whole point of
   * the on/off toggle.
   */
  const banks = await listVoucherBankAccounts(options.locationId, challan.branchId);

  const graceDays =
    lateFeeRule !== null && lateFeeRule.isEnabled ? Math.max(lateFeeRule.graceDays, 0) : 0;

  const validUpto = addDays(challan.dueDate, graceDays);

  /*
   * What the parent would pay on the first day a charge could actually land:
   * the day after grace runs out. Priced through the fee module's own
   * `calculateLateFee` rather than restated here, so the slip and the *Apply
   * late fee* button cannot disagree about the policy.
   */
  const lateFeeAfterDueDate =
    lateFeeRule === null || !lateFeeRule.isEnabled
      ? null
      : calculateLateFee(challan.dueDate, lateFeeRule, parseDateOnly(addDays(challan.dueDate, graceDays + 1)));

  return assemble(challan, {
    logoUrl: options.logoUrl,
    validUpto,
    // Null means "print no after-due-date row at all". Zero would be a row.
    lateFeeAfterDueDate:
      lateFeeAfterDueDate === null || lateFeeAfterDueDate <= 0
        ? null
        : lateFeeAfterDueDate.toFixed(2),
    banks: banks.map((bank) => ({
      id: bank.id,
      bankName: bank.bankName,
      accountTitle: bank.accountTitle,
      accountNumber: bank.accountNumber,
      branchNameOfBank: bank.branchNameOfBank,
      branchCode: bank.branchCode,
      iban: bank.iban,
      swiftCode: bank.swiftCode,
      bankAddress: bank.bankAddress,
      intermediaryBank: bank.intermediaryBank,
      intermediarySwift: bank.intermediarySwift,
      currency: bank.currency,
      instructions: bank.instructions,
    })),
  });
}

/**
 * The half of a printed fee document that is the same on both of them.
 *
 * Sprint 33c pulled this out of `buildVoucherPrintData` so that the receipt
 * could reuse it without either re-reading the bank accounts it does not print
 * or re-spreading `ChallanDetail` by hand — which is the thing the docblock
 * above exists to stop happening a fourth time. Everything that *differs*
 * between the two documents is an argument.
 */
function assemble(
  challan: ChallanDetail,
  parts: Pick<
    ChallanPrintData,
    'logoUrl' | 'validUpto' | 'lateFeeAfterDueDate' | 'banks'
  >,
): ChallanPrintData {
  return {
    challanNumber: challan.challanNumber,
    schoolName: challan.schoolName,
    schoolAddress: challan.branchAddress ?? challan.schoolAddress,
    schoolPhone: challan.branchPhone ?? challan.schoolPhone,
    schoolEmail: challan.branchEmail ?? challan.schoolEmail,
    schoolNtn: challan.schoolNtn,
    schoolWebsite: challan.schoolWebsite,
    schoolFinanceEmail: challan.schoolFinanceEmail,
    branchName: challan.branchName,
    studentName: challan.studentName,
    studentId: challan.studentId,
    studentEmail: challan.studentEmail,
    guardianEmail: challan.guardian?.email ?? null,
    gradeName: challan.gradeName,
    sectionName: challan.sectionName,
    rollNumber: challan.rollNumber,
    billingMonth: challan.billingMonth,
    billingYear: challan.billingYear,
    academicYearName: challan.academicYearName,
    issueDate: challan.issueDate,
    dueDate: challan.dueDate,
    validUpto: parts.validUpto,
    subtotal: challan.subtotal,
    concessionAmount: challan.concessionAmount,
    creditApplied: challan.creditApplied,
    lateFeeAmount: challan.lateFeeAmount,
    lateFeeAfterDueDate: parts.lateFeeAfterDueDate,
    totalAmount: challan.totalAmount,
    paidAmount: challan.paidAmount,
    items: challan.items,
    banks: parts.banks,
    logoUrl: parts.logoUrl,
  };
}

/**
 * The receipt for a voucher that has been paid, in whole or in part.
 * Sprint 33c, C2.
 *
 * ── Why this sits beside `buildVoucherPrintData` and not in a new module ──
 * Same reason that one exists. Three screens print a fee document — the
 * parent's portal, the admin detail page and the bulk run — and the moment one
 * of them assembles it by hand the three drift, which is precisely the defect
 * Sprint 20 spent an afternoon undoing. The receipt now has the same property:
 * one helper, three callers, and nothing to keep in step.
 *
 * ── What it is NOT ───────────────────────────────────────────────────────
 * It is not the voucher with a different word at the top. Sprint 20's decision
 * that a paid slip must not read as a demand stands and is what `kind` on
 * `ChallanPrintData` enforces: **no bank block** — account numbers under the
 * word RECEIPT read as a second request for the money — and **no "valid upto"**,
 * because there is no last day on which a settled figure is what is owed.
 *
 * ── It refuses to build a receipt for an unpaid voucher ──────────────────
 * Null, rather than a document reading "Total received: 0.00". A receipt for
 * nothing is the mirror of the demand-for-a-settled-bill this whole decision
 * exists to prevent: it is a piece of school stationery saying money changed
 * hands when it did not. The callers render nothing and offer no button.
 *
 * `partial` is deliberately included. A parent who has paid half has had half
 * their money taken and is entitled to the record of it — and the two documents
 * are then both offered, one for what is still owed and one for what has been
 * received, which is the honest description of that voucher.
 *
 * ── Outstanding is not computed here ─────────────────────────────────────
 * The printed "Outstanding" line is a literal zero in the component. That is
 * not a rounding shortcut: on a `partial` voucher the outstanding balance
 * belongs on the *voucher*, which is the document that asks for it. A receipt
 * says what was received, and the amount received is outstanding against
 * nothing.
 */
export function buildReceiptPrintData(
  challan: ChallanDetail,
  options: { logoUrl: string | null },
): ChallanPrintData | null {
  if (challan.status !== 'paid' && challan.status !== 'partial') return null;
  if (challan.payments.length === 0) return null;

  return {
    ...assemble(challan, {
      logoUrl: options.logoUrl,
      // A receipt carries no bank block and no after-due-date figure, and
      // neither is reachable by a caller passing the wrong options. It is also
      // why this function is synchronous: the only read `buildVoucherPrintData`
      // makes is for the accounts a receipt does not print.
      banks: [],
      validUpto: null,
      lateFeeAfterDueDate: null,
    }),
    kind: 'receipt',
    // Oldest first: a parent reading three visits wants them in the order they
    // happened, and `ChallanPrintView` takes the **last** one as "Paid on".
    payments: [...challan.payments]
      .sort((left, right) => left.paymentDate.localeCompare(right.paymentDate))
      .map((payment) => ({
        id: payment.id,
        paymentDate: payment.paymentDate,
        amount: payment.amount,
        method: PAYMENT_METHOD_LABELS[payment.paymentMethod],
        referenceNumber: payment.referenceNumber,
      })),
  };
}

/**
 * `YYYY-MM-DD` plus n whole days, in UTC.
 *
 * UTC on purpose: a due date is a `date` column with no time in it, and doing
 * this in local time makes the answer depend on the server's timezone — which
 * on Hostinger is not Pakistan's.
 */
function addDays(dateOnly: string, days: number): string {
  if (days === 0) return dateOnly;
  const at = new Date(`${dateOnly}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}
