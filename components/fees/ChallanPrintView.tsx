import { PrintDocument, PrintLetterhead, PrintSheet } from '@/components/print/PrintSheet';
import { MONTH_NAMES } from '@/db/schema/academic-years';
import { FEE_CATEGORY_LABELS, type FeeCategory } from '@/db/schema/fee-types';
import { formatDateOnly } from '@/lib/dates';
import { amountInWords, formatAmount, toPaise } from '@/lib/money';

/**
 * The printable voucher: three identical copies **side by side** on one
 * landscape A4 sheet.
 *
 * Pakistani school fees are paid over a bank counter, and the bank expects a
 * three-part slip — one copy stays with the school, one with the bank, one with
 * the parent — separated by cut lines. That is why this is one page with three
 * sections rather than three pages, and why each section repeats the whole bill
 * instead of referring back to the first.
 *
 * ── Why they are columns now, and not stacked ────────────────────────────
 * They were three portrait bands cut horizontally, which is not the shape the
 * counter takes: a teller tears a voucher into three *vertical* strips, keeps
 * the middle one and hands the third back. Stacked copies also gave each one a
 * third of an A4's height, so a bill with six heads and an adjustment ran into
 * the cut line below it. Landscape thirds are wider than they are tall, which
 * is the proportion of the slip a school already prints at a stationer.
 *
 * The mechanics of getting it onto paper — hiding the portal shell, page size,
 * break behaviour — belong to `<PrintSheet>`, not here. This file is only the
 * voucher's own layout.
 *
 * Two entry points:
 *   `ChallanPrintView`  one voucher, its own sheet. Used by the detail page.
 *   `ChallanCopies`     the three copies alone, for callers that are printing
 *                       many vouchers into a single sheet and print job.
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

export interface ChallanPrintData {
  challanNumber: string;
  schoolName: string;
  schoolAddress: string | null;
  schoolPhone: string | null;
  branchName: string | null;
  studentName: string;
  studentId: string;
  gradeName: string | null;
  sectionName: string | null;
  rollNumber: string | null;
  billingMonth: number | null;
  billingYear: number | null;
  academicYearName: string;
  issueDate: string;
  dueDate: string;
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
  totalAmount: string;
  paidAmount: string;
  items: readonly ChallanPrintItem[];
  /** School logo for the letterhead. Null when the school has not set one. */
  logoUrl?: string | null;
}

const COPIES = ['SCHOOL COPY', 'BANK COPY', 'STUDENT COPY'] as const;

function billingPeriod(data: ChallanPrintData): string {
  if (data.billingMonth === null || data.billingYear === null) {
    return data.academicYearName;
  }
  return `${MONTH_NAMES[data.billingMonth - 1] ?? data.billingMonth} ${data.billingYear}`;
}

/**
 * The `Details` line under one particular, or null when there is nothing to say.
 *
 * Three facts, joined: what kind of fee this is, the period it covers, and the
 * concession that reduced it. Assembled here rather than persisted whole
 * because only the third is a historical fact about this voucher — the other
 * two are on the voucher's own header and are repeated where the eye already is.
 */
function detailsFor(item: ChallanPrintItem, data: ChallanPrintData): string | null {
  const parts: string[] = [];

  const category = (item.feeCategory ?? '').trim();
  if (category !== '') parts.push(FEE_CATEGORY_LABELS[category as FeeCategory] ?? category);

  parts.push(billingPeriod(data));

  const concession = (item.concessionDetail ?? '').trim();
  if (concession !== '') parts.push(concession);

  return parts.length === 0 ? null : parts.join(' · ');
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
 * The three copies, without a sheet around them.
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
  const balancePaise = toPaise(data.totalAmount) - toPaise(data.paidAmount);

  return (
    <PrintDocument breakAfter={breakAfter}>
      {/*
        Three equal columns. `grid` rather than flex so every copy is exactly a
        third of the sheet whatever the longest one contains — a bill whose
        School copy grew a line taller than the other two would tear crooked.

        `breakAfter` on the document above still gives one voucher per sheet in
        a bulk run; nothing about the columns changes that.
      */}
      <div className="grid grid-cols-3">
        {COPIES.map((copy, index) => (
          <section
            key={copy}
            className={
              index === COPIES.length - 1
                ? 'challan-copy px-2'
                : // The cut line is the edge between two columns rather than a
                  // row of scissors: a teller cuts down the sheet, and a dashed
                  // rule is what they cut along.
                  'challan-copy border-r border-dashed border-black px-2'
            }
          >
            <ChallanCopy data={data} copyLabel={copy} balancePaise={balancePaise} />
          </section>
        ))}
      </div>
    </PrintDocument>
  );
}

function ChallanCopy({
  data,
  copyLabel,
  balancePaise,
}: {
  data: ChallanPrintData;
  copyLabel: string;
  balancePaise: number;
}) {
  return (
    <div className="text-[10px] leading-tight">
      <PrintLetterhead
        logoUrl={data.logoUrl ?? null}
        schoolName={data.schoolName}
        branchName={data.branchName}
        address={data.schoolAddress}
        phone={data.schoolPhone}
        right={
          <>
            <p className="border border-black px-2 py-0.5 text-[9px] font-bold tracking-wide">
              {copyLabel}
            </p>
            <p className="mt-1 font-mono text-[10px] font-bold">{data.challanNumber}</p>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 py-1.5">
        <Field label="Student" value={data.studentName} />
        <Field label="Student ID" value={data.studentId} mono />
        <Field
          label="Class"
          value={`${data.gradeName ?? '—'}${data.sectionName === null ? '' : ` ${data.sectionName}`}`}
        />
        <Field label="Roll no." value={data.rollNumber ?? '—'} />
        <Field label="Period" value={billingPeriod(data)} />
        <Field label="Session" value={data.academicYearName} />
        <Field label="Issue date" value={formatDateOnly(data.issueDate)} />
        <Field label="Due date" value={formatDateOnly(data.dueDate)} />
      </div>

      <table className="w-full border-collapse text-[10px]">
        <thead>
          <tr className="border-y border-black">
            <th scope="col" className="py-0.5 text-left font-bold">Particulars</th>
            <th scope="col" className="py-0.5 text-right font-bold">Amount</th>
            <th scope="col" className="py-0.5 text-right font-bold">Concession</th>
            <th scope="col" className="py-0.5 text-right font-bold">Net</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((item, index) => (
            <tr key={`${item.description}-${index}`} className="border-b border-dotted border-black">
              <td className="py-0.5">
                {item.description}
                {/*
                  The line explains itself (items 10 and 14).

                  A bare minus-4,000 in the Concession column is a figure a
                  parent has to telephone the school about. The category and the
                  period say what the charge is *for*; the concession detail
                  says which discount took the money off and at what rate, in
                  the words the school used the day the voucher was raised.
                */}
                {detailsFor(item, data) === null ? null : (
                  <span className="block text-[8px] leading-snug text-black/70">
                    {detailsFor(item, data)}
                  </span>
                )}
              </td>
              <td className="py-0.5 text-right">{formatAmount(item.amount)}</td>
              <td className="py-0.5 text-right">
                {Number(item.concessionAmount) === 0
                  ? '—'
                  : `−${formatAmount(item.concessionAmount)}`}
              </td>
              <td className="py-0.5 text-right">{formatAmount(item.netAmount)}</td>
            </tr>
          ))}

          {/*
            The adjustment, above the late fee, in the order the total is
            built: subtotal − concession − credit + late fee. It is a header
            figure and not an item because an adjustment has no fee head — it
            is money the school already owed this child, not a charge.
          */}
          {toPaise(data.creditApplied ?? '0') === 0 ? null : (
            <tr className="border-b border-dotted border-black">
              <td className="py-0.5">Adjustment — credit carried forward</td>
              <td className="py-0.5 text-right">—</td>
              <td className="py-0.5 text-right">
                {`−${formatAmount(data.creditApplied ?? '0')}`}
              </td>
              <td className="py-0.5 text-right">
                {`−${formatAmount(data.creditApplied ?? '0')}`}
              </td>
            </tr>
          )}

          {Number(data.lateFeeAmount) === 0 ? null : (
            <tr className="border-b border-dotted border-black">
              <td className="py-0.5">Late fee</td>
              <td className="py-0.5 text-right">{formatAmount(data.lateFeeAmount)}</td>
              <td className="py-0.5 text-right">—</td>
              <td className="py-0.5 text-right">{formatAmount(data.lateFeeAmount)}</td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr className="border-y border-black">
            <th scope="row" colSpan={3} className="py-1 text-right font-bold">
              Total payable
            </th>
            <td className="py-1 text-right text-[12px] font-bold">
              {formatAmount(data.totalAmount)}
            </td>
          </tr>

          {toPaise(data.paidAmount) === 0 ? null : (
            <tr className="border-b border-black">
              <th scope="row" colSpan={3} className="py-0.5 text-right font-bold">
                Already paid / Balance
              </th>
              <td className="py-0.5 text-right">
                {formatAmount(data.paidAmount)} / {formatAmount(balancePaise / 100)}
              </td>
            </tr>
          )}
        </tfoot>
      </table>

      {/* The figure in words is what stops a 1,000 becoming a 10,000 between
          the school gate and the cashier's window. */}
      <p className="mt-1 border border-black px-1.5 py-1 text-[9px]">
        <span className="font-bold">Amount in words: </span>
        {amountInWords(data.totalAmount)}
      </p>

      <div className="mt-2 flex items-end justify-between gap-4 text-[9px]">
        <p>
          Please pay on or before{' '}
          <span className="font-bold">{formatDateOnly(data.dueDate)}</span>. A late
          payment may attract a surcharge.
        </p>
        <p className="w-32 border-t border-black pt-0.5 text-center">
          Authorised signature
        </p>
      </div>
    </div>
  );
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
    <p className="flex gap-1">
      <span className="font-bold">{label}:</span>
      <span className={mono ? 'font-mono' : undefined}>{value}</span>
    </p>
  );
}
