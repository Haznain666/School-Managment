import { PrintDocument, PrintSheet } from '@/components/print/PrintSheet';
import { MONTH_NAMES } from '@/db/schema/academic-years';
import { formatDateOnly } from '@/lib/dates';
import { amountInWords, formatAmount, toPaise } from '@/lib/money';

/**
 * The printable fee voucher: **two** identical copies side by side on one
 * landscape A4 sheet.
 *
 * ── Two copies, not three (Sprint 20, decision D1) ───────────────────────
 * `STUDENT COPY` and `SCHOOL COPY`. It was three — school, bank, student — and
 * the third had a job only while the bank's details were *not* on the slip: the
 * teller kept a copy because the copy was the record. Now that the account
 * title, number and IBAN are printed on the voucher itself, the teller reads
 * them off the slip in front of them and keeps nothing. Two copies also give
 * each one half a sheet instead of a third, which is what the bank block and
 * the notes need to fit without running into the cut line.
 *
 * ── Colour comes from the school's palette, never from a hex ─────────────
 * The header band and the table rules are drawn with `rgb(var(--brand-primary))`
 * and the ink variables, so a voucher printed at a school with a green palette
 * is green and one at a school with a blue palette is blue. `lib/brand-derive.ts`
 * is where those variables come from and `npm run check-theme` is the gate. A
 * voucher printed in a hard-coded blue is a regression, not a design.
 *
 * The one deliberate exception is the **cut line and the sheet's own text**,
 * which stay black: paper is white whatever the school's palette is —
 * `globals.css` forces that under `@media print` — and a dark-palette school's
 * `--ink` on white would be unreadable. So the document's body text is
 * `text-black` and only the *brand* elements take the variable.
 *
 * ── Print mechanics belong to `<PrintSheet>` ─────────────────────────────
 * Page size, hiding the portal shell and break behaviour are all its job and
 * are not re-implemented here. STATE.md §5bd records a careless global print
 * rule making every voucher come out blank; this file is only the voucher's own
 * layout.
 *
 * Two entry points:
 *   `ChallanPrintView`  one voucher, its own sheet. Used by the detail pages.
 *   `ChallanCopies`     the copies alone, for callers printing many vouchers
 *                       into a single sheet and print job.
 */

export interface ChallanPrintItem {
  description: string;
  amount: string;
  concessionAmount: string;
  netAmount: string;
  /** The head's category — `monthly`, `one_time`. Optional for older callers. */
  feeCategory?: string | null;
  /** `Sibling Discount 20%`, persisted on the line at generation time. */
  concessionDetail?: string | null;
}

/** One account, as the payment block prints it. */
export interface VoucherBankAccount {
  id: string;
  bankName: string;
  accountTitle: string;
  accountNumber: string;
  branchNameOfBank: string | null;
  branchCode: string | null;
  iban: string | null;
  swiftCode: string | null;
  bankAddress: string | null;
  intermediaryBank: string | null;
  intermediarySwift: string | null;
  currency: string;
  instructions: string | null;
}

export interface ChallanPrintData {
  challanNumber: string;
  schoolName: string;
  schoolAddress: string | null;
  schoolPhone: string | null;
  /** The office address a query about this voucher goes to. */
  schoolEmail?: string | null;
  /** Printed in the header when set, omitted with its label when not. */
  schoolNtn?: string | null;
  schoolWebsite?: string | null;
  /**
   * Where a parent sends proof of payment. The notes block is printed **only**
   * when this exists — an instruction to email nobody is worse than none.
   */
  schoolFinanceEmail?: string | null;
  branchName: string | null;
  studentName: string;
  studentId: string;
  studentEmail?: string | null;
  guardianEmail?: string | null;
  gradeName: string | null;
  sectionName: string | null;
  rollNumber: string | null;
  billingMonth: number | null;
  billingYear: number | null;
  academicYearName: string;
  issueDate: string;
  dueDate: string;
  /**
   * The last day the figure on the left is what the parent owes: the due date
   * plus the school's grace days where late fees are configured, and the due
   * date otherwise. Optional so every existing caller compiles; absent falls
   * back to the due date, which is the no-policy answer.
   */
  validUpto?: string | null;
  subtotal: string;
  concessionAmount: string;
  /**
   * Credit carried forward that this voucher spends (Sprint 17).
   *
   * Optional so that every existing caller compiles unchanged and prints
   * exactly what it printed before; absent and `'0'` both mean "no adjustment",
   * and the row is omitted rather than printed as a zero. A parent holding a
   * slip with a mysterious `−0.00` on it has been given a question, not an
   * answer.
   */
  creditApplied?: string | null;
  lateFeeAmount: string;
  /**
   * The late fee the school's own rule would charge on the first chargeable
   * day, or null when the school has no policy.
   *
   * **Null omits the after-due-date row entirely.** A row saying the two totals
   * are equal teaches a parent that paying late costs nothing.
   */
  lateFeeAfterDueDate?: string | null;
  totalAmount: string;
  paidAmount: string;
  items: readonly ChallanPrintItem[];
  /** Active, student-facing accounts for this voucher's campus. */
  banks?: readonly VoucherBankAccount[];
  /** School logo for the letterhead. Null when the school has not set one. */
  logoUrl?: string | null;
}

const COPIES = ['STUDENT COPY', 'SCHOOL COPY'] as const;

/**
 * The version printed in the dates block.
 *
 * Always `1`. The product has no voucher versioning: a voucher is regenerated
 * rather than revised, and a reprint is the same document. The reference
 * carries the field so it is printed, and **no scheme is invented to fill it** —
 * a number a reader cannot act on is acceptable; a number that changes meaning
 * between two prints of one slip is not.
 */
const VOUCHER_VERSION = '1';

function billingPeriod(data: ChallanPrintData): string {
  if (data.billingMonth === null || data.billingYear === null) {
    return data.academicYearName;
  }
  return `${MONTH_NAMES[data.billingMonth - 1] ?? data.billingMonth} ${data.billingYear}`;
}

/** One voucher on its own sheet. */
export function ChallanPrintView({ data }: { data: ChallanPrintData }) {
  return (
    <PrintSheet paper="a4" orientation="landscape">
      <ChallanCopies data={data} />
    </PrintSheet>
  );
}

/**
 * The copies, without a sheet around them.
 *
 * Exported so bulk printing can put many vouchers into one sheet and one print
 * job — see `dashboard/fees/challans/print`. `breakAfter` starts a fresh page
 * after this voucher, which is what keeps one student per sheet.
 */
export function ChallanCopies({
  data,
  breakAfter = false,
}: {
  data: ChallanPrintData;
  breakAfter?: boolean;
}) {
  return (
    <PrintDocument breakAfter={breakAfter}>
      {/*
        Two equal columns. `grid` rather than flex so each copy is exactly half
        the sheet whatever the longest one contains — a bill whose School copy
        grew a line taller than the other would tear crooked.
      */}
      <div className="grid grid-cols-2">
        {COPIES.map((copy, index) => (
          <section
            key={copy}
            className={
              index === COPIES.length - 1
                ? 'challan-copy px-3'
                : // The cut line is the edge between the two columns rather
                  // than a row of scissors: a teller cuts down the sheet, and
                  // a dashed rule is what they cut along. Black, not `--line`:
                  // paper is white whatever the palette is.
                  'challan-copy border-r border-dashed border-black px-3'
            }
          >
            <ChallanCopy data={data} copyLabel={copy} />
          </section>
        ))}
      </div>
    </PrintDocument>
  );
}

function ChallanCopy({
  data,
  copyLabel,
}: {
  data: ChallanPrintData;
  copyLabel: string;
}) {
  const balancePaise = toPaise(data.totalAmount) - toPaise(data.paidAmount);
  const creditPaise = toPaise(data.creditApplied ?? '0');
  const discountPaise = toPaise(data.concessionAmount);

  const afterDueTotal =
    data.lateFeeAfterDueDate === null || data.lateFeeAfterDueDate === undefined
      ? null
      : (toPaise(data.totalAmount) + toPaise(data.lateFeeAfterDueDate)) / 100;

  const banks = data.banks ?? [];

  return (
    <div className="text-[10px] leading-tight text-black">
      {/* 1 — Header. Logo left, school beside it, copy label and the numbers
          that identify this slip on the right. */}
      <header className="flex items-start justify-between gap-3 border-b-2 border-[rgb(var(--brand-primary))] pb-1.5">
        <div className="flex items-start gap-2">
          {data.logoUrl === null || data.logoUrl === undefined || data.logoUrl === '' ? null : (
            /*
              A plain `<img>`, and the disable is on the element rather than the
              conditional above it because that is where the rule fires. The
              print renderer wants a resolved URL, not a lazy-loading,
              srcset-driven component that may not have settled by the time the
              print dialog opens — the same reasoning `PrintLetterhead` carries.
            */
            // eslint-disable-next-line @next/next/no-img-element -- see above.
            <img src={data.logoUrl} alt="" className="h-11 w-11 shrink-0 object-contain" />
          )}

          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-[rgb(var(--brand-primary))]">
              {data.schoolName}
            </p>
            {data.branchName === null ? null : (
              <p className="text-[9px] uppercase tracking-wide">{data.branchName}</p>
            )}
            <p className="text-[9px] font-semibold uppercase tracking-wide">
              Fee Voucher
            </p>
          </div>
        </div>

        <div className="text-right">
          <p className="inline-block border border-black px-2 py-0.5 text-[9px] font-bold tracking-wide">
            {copyLabel}
          </p>
          <p className="mt-1 text-[9px]">{billingPeriod(data)}</p>
          {/* Printed only when the school has one. A blank `NTN #` is a
              question a parent asks at the counter. */}
          {data.schoolNtn === null || data.schoolNtn === undefined || data.schoolNtn === '' ? null : (
            <p className="text-[9px]">
              NTN # <span className="font-mono">{data.schoolNtn}</span>
            </p>
          )}
          <p className="font-mono text-[11px] font-bold">
            Voucher # {data.challanNumber}
          </p>
        </div>
      </header>

      {/* 2 — Student block. */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 py-1.5">
        <Field label="ID" value={data.studentId} mono />
        <Field label="Name" value={data.studentName} />
        <Field label="Class" value={classLabel(data)} />
        <Field label="Roll no." value={data.rollNumber ?? '—'} />
        <Field label="Email" value={blankToDash(data.studentEmail)} />
        <Field label="Parent email" value={blankToDash(data.guardianEmail)} />
      </div>

      {/* 3 — Dates. */}
      <div className="grid grid-cols-4 border-y border-[rgb(var(--brand-primary))] py-1">
        <Stamp label="Issue date" value={formatDateOnly(data.issueDate)} />
        <Stamp label="Due date" value={formatDateOnly(data.dueDate)} />
        <Stamp
          label="Valid upto"
          value={formatDateOnly(
            data.validUpto === null || data.validUpto === undefined
              ? data.dueDate
              : data.validUpto,
          )}
        />
        {/* No versioning exists. See `VOUCHER_VERSION`. */}
        <Stamp label="Version" value={VOUCHER_VERSION} />
      </div>

      {/* 4 — Particulars. Two columns, exactly as the reference has it: what
          the charge is, and what is payable for it. */}
      <table className="mt-1.5 w-full border-collapse text-[10px]">
        <thead>
          <tr className="border-y border-black bg-[rgb(var(--brand-primary)/0.12)]">
            <th scope="col" className="py-1 pl-1 text-left font-bold">
              Particulars
            </th>
            <th scope="col" className="py-1 pr-1 text-right font-bold">
              Payable Amount (PKR)
            </th>
          </tr>
        </thead>
        <tbody>
          {/* The charges, gross. Every discount is its own row below, in
              parentheses — which is how an accountant reads a deduction and how
              the reference document sets it out. */}
          {data.items.map((item, index) => (
            <tr
              key={`${item.description}-${String(index)}`}
              className="border-b border-dotted border-black"
            >
              <td className="py-0.5 pl-1">{item.description}</td>
              <td className="py-0.5 pr-1 text-right tabular-nums">
                {formatAmount(item.amount)}
              </td>
            </tr>
          ))}

          <tr className="border-b border-black">
            <th scope="row" className="py-0.5 pl-1 text-left font-semibold">
              Gross amount
            </th>
            <td className="py-0.5 pr-1 text-right font-semibold tabular-nums">
              {formatAmount(data.subtotal)}
            </td>
          </tr>

          {/*
            One row per discounted line, named. `concession_detail` is frozen on
            the line when the voucher is raised — "Sibling Discount 20%" — so
            the slip says which policy took the money off and at what rate, in
            the words the school used that day. A bare negative figure is
            something a parent has to telephone about.
          */}
          {data.items
            .filter((item) => toPaise(item.concessionAmount) > 0)
            .map((item, index) => (
              <tr
                key={`discount-${item.description}-${String(index)}`}
                className="border-b border-dotted border-black"
              >
                <td className="py-0.5 pl-1">
                  {(item.concessionDetail ?? '').trim() === ''
                    ? `Discount — ${item.description}`
                    : item.concessionDetail}
                </td>
                <td className="py-0.5 pr-1 text-right tabular-nums">
                  ({formatAmount(item.concessionAmount)})
                </td>
              </tr>
            ))}

          {/*
            The adjustment, above the totals and in the order the total is
            built: gross − discounts − credit + late fee. It is a header figure
            and not an item because an adjustment has no fee head — it is money
            the school already owed this child, not a charge.
          */}
          {creditPaise === 0 ? null : (
            <tr className="border-b border-dotted border-black">
              <td className="py-0.5 pl-1">Adjustment — credit carried forward</td>
              <td className="py-0.5 pr-1 text-right tabular-nums">
                ({formatAmount(data.creditApplied ?? '0')})
              </td>
            </tr>
          )}

          {discountPaise === 0 && creditPaise === 0 ? null : (
            <tr className="border-b border-black">
              <th scope="row" className="py-0.5 pl-1 text-left font-semibold">
                Total deductions
              </th>
              <td className="py-0.5 pr-1 text-right font-semibold tabular-nums">
                ({formatAmount((discountPaise + creditPaise) / 100)})
              </td>
            </tr>
          )}

          {toPaise(data.lateFeeAmount) === 0 ? null : (
            <tr className="border-b border-dotted border-black">
              <td className="py-0.5 pl-1">Late fee already charged</td>
              <td className="py-0.5 pr-1 text-right tabular-nums">
                {formatAmount(data.lateFeeAmount)}
              </td>
            </tr>
          )}

          {toPaise(data.paidAmount) === 0 ? null : (
            <tr className="border-b border-dotted border-black">
              <td className="py-0.5 pl-1">Already paid</td>
              <td className="py-0.5 pr-1 text-right tabular-nums">
                ({formatAmount(data.paidAmount)})
              </td>
            </tr>
          )}
        </tbody>

        <tfoot>
          <tr className="border-y-2 border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary)/0.12)]">
            <th scope="row" className="py-1 pl-1 text-left text-[10px] font-bold uppercase">
              Total amount payable within due date
            </th>
            <td className="py-1 pr-1 text-right text-[12px] font-bold tabular-nums">
              {formatAmount(
                toPaise(data.paidAmount) === 0 ? data.totalAmount : balancePaise / 100,
              )}
            </td>
          </tr>

          {/*
            Omitted entirely when the school has no late fee configured.

            A row saying the two totals are equal teaches a parent that paying
            late costs nothing — which at a school with no policy happens to be
            true, and is precisely why printing it is worse than leaving it out.
          */}
          {afterDueTotal === null ? null : (
            <tr className="border-b border-black">
              <th scope="row" className="py-1 pl-1 text-left text-[10px] font-bold uppercase">
                Total amount payable after due date
              </th>
              <td className="py-1 pr-1 text-right text-[11px] font-bold tabular-nums">
                {formatAmount(afterDueTotal)}
              </td>
            </tr>
          )}
        </tfoot>
      </table>

      {/* The figure in words is what stops a 1,000 becoming a 10,000 between
          the school gate and the cashier's window. The reference omits it; that
          is not a reason to drop it. */}
      <p className="mt-1 border border-black px-1.5 py-1 text-[9px]">
        <span className="font-bold">Amount in words: </span>
        {amountInWords(
          toPaise(data.paidAmount) === 0 ? data.totalAmount : balancePaise / 100,
        )}
      </p>

      {/* 5 — Payment methods. */}
      <section className="mt-1.5">
        <h3 className="border-b border-[rgb(var(--brand-primary))] pb-0.5 text-[9px] font-bold uppercase tracking-wide text-[rgb(var(--brand-primary))]">
          How to pay
        </h3>

        <p className="mt-0.5 text-[9px]">
          Cash or pay order at the school office, in favour of{' '}
          <span className="font-semibold">{data.schoolName}</span>. A cheque is
          receipted when it clears.
        </p>

        {banks.length === 0 ? null : (
          <ul className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1">
            {banks.map((bank) => (
              <li key={bank.id} className="border-l-2 border-[rgb(var(--brand-primary))] pl-1.5">
                <p className="text-[9px] font-bold">
                  {bank.bankName}
                  {bank.branchNameOfBank === null ? '' : ` — ${bank.branchNameOfBank}`}
                  {bank.currency === 'PKR' ? '' : ` (${bank.currency})`}
                </p>
                <p className="text-[9px]">{bank.accountTitle}</p>
                <p className="font-mono text-[9px]">A/C {bank.accountNumber}</p>
                {bank.iban === null ? null : (
                  <p className="font-mono text-[9px]">IBAN {bank.iban}</p>
                )}
                {/* The international block, printed only when a school has one.
                    A domestic-only school sees none of these three lines. */}
                {bank.swiftCode === null ? null : (
                  <p className="font-mono text-[9px]">SWIFT {bank.swiftCode}</p>
                )}
                {bank.intermediaryBank === null ? null : (
                  <p className="text-[8px]">
                    Intermediary: {bank.intermediaryBank}
                    {bank.intermediarySwift === null ? '' : ` (${bank.intermediarySwift})`}
                  </p>
                )}
                {bank.bankAddress === null ? null : (
                  <p className="text-[8px]">{bank.bankAddress}</p>
                )}
                {bank.instructions === null ? null : (
                  <p className="text-[8px] italic">{bank.instructions}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 6 — Notes. Printed only when there is somewhere to send the proof:
          an instruction to email nobody is worse than no instruction. */}
      {data.schoolFinanceEmail === null ||
      data.schoolFinanceEmail === undefined ||
      data.schoolFinanceEmail === '' ? null : (
        <p className="mt-1.5 border border-dashed border-black px-1.5 py-1 text-[8px]">
          <span className="font-bold">Note: </span>
          After paying by transfer or deposit, email the receipt to{' '}
          <span className="font-semibold">{data.schoolFinanceEmail}</span> quoting
          voucher <span className="font-mono">{data.challanNumber}</span> and the
          student ID <span className="font-mono">{data.studentId}</span>. A payment
          without a reference can take several days to trace.
        </p>
      )}

      {/* 7 — Footer. */}
      <footer className="mt-1.5 flex items-end justify-between gap-3 border-t border-[rgb(var(--brand-primary))] pt-1 text-[8px]">
        <div className="min-w-0">
          {data.schoolAddress === null ? null : <p>{data.schoolAddress}</p>}
          <p>
            {[
              data.schoolPhone === null ? null : `Tel ${data.schoolPhone}`,
              blankToNull(data.schoolEmail),
              blankToNull(data.schoolWebsite),
            ]
              .filter((part): part is string => part !== null)
              .join(' · ')}
          </p>
        </div>
        <p className="w-28 shrink-0 border-t border-black pt-0.5 text-center">
          Authorised signature
        </p>
      </footer>
    </div>
  );
}

function classLabel(data: ChallanPrintData): string {
  return `${data.gradeName ?? '—'}${data.sectionName === null ? '' : ` ${data.sectionName}`}`;
}

function blankToDash(value: string | null | undefined): string {
  return value === null || value === undefined || value.trim() === '' ? '—' : value;
}

function blankToNull(value: string | null | undefined): string | null {
  return value === null || value === undefined || value.trim() === '' ? null : value;
}

function Field({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <p className="flex min-w-0 gap-1">
      <span className="shrink-0 font-bold">{label}:</span>
      <span className={mono ? 'truncate font-mono' : 'truncate'}>{value}</span>
    </p>
  );
}

/** One of the four dated stamps under the student block. */
function Stamp({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-1">
      <p className="text-[7px] font-bold uppercase tracking-wide text-black/70">
        {label}
      </p>
      <p className="text-[9px] font-semibold tabular-nums">{value}</p>
    </div>
  );
}
