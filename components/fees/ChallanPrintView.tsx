import { MONTH_NAMES } from '@/db/schema/academic-years';
import { amountInWords, formatAmount, toPaise } from '@/lib/money';

/**
 * The printable challan: three identical copies on one A4 sheet.
 *
 * Pakistani school fees are paid over a bank counter, and the bank expects a
 * three-part slip — one copy stays with the school, one with the bank, one with
 * the parent — separated by cut lines. That is why this is one page with three
 * sections rather than three pages, and why each section repeats the whole bill
 * instead of referring back to the first.
 *
 * It renders on screen only when printing: the container is `hidden` and the
 * `@media print` rules in `globals.css` reveal it while blanking the portal
 * shell around it. No PDF library is involved — the browser's own print dialog
 * is the renderer, which is one less dependency between a school and its money.
 */

export interface ChallanPrintItem {
  description: string;
  amount: string;
  concessionAmount: string;
  netAmount: string;
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
  lateFeeAmount: string;
  totalAmount: string;
  paidAmount: string;
  items: readonly ChallanPrintItem[];
}

const COPIES = ['SCHOOL COPY', 'BANK COPY', 'STUDENT COPY'] as const;

function billingPeriod(data: ChallanPrintData): string {
  if (data.billingMonth === null || data.billingYear === null) {
    return data.academicYearName;
  }
  return `${MONTH_NAMES[data.billingMonth - 1] ?? data.billingMonth} ${data.billingYear}`;
}

export function ChallanPrintView({ data }: { data: ChallanPrintData }) {
  const balancePaise = toPaise(data.totalAmount) - toPaise(data.paidAmount);

  return (
    <div id="challan-print" className="hidden bg-white text-black">
      {COPIES.map((copy, index) => (
        <section
          key={copy}
          className="challan-copy border border-black p-3"
          style={{ marginBottom: index === COPIES.length - 1 ? 0 : '4mm' }}
        >
          <ChallanCopy data={data} copyLabel={copy} balancePaise={balancePaise} />

          {index === COPIES.length - 1 ? null : (
            <p
              aria-hidden="true"
              className="mt-3 border-t border-dashed border-black pt-1 text-center text-[9px] tracking-widest text-black"
            >
              ✂ — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — —
            </p>
          )}
        </section>
      ))}
    </div>
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
      <header className="flex items-start justify-between gap-3 border-b border-black pb-1.5">
        <div>
          <p className="text-sm font-bold uppercase">{data.schoolName}</p>
          {data.branchName === null ? null : (
            <p className="text-[9px]">{data.branchName}</p>
          )}
          {data.schoolAddress === null ? null : (
            <p className="text-[9px]">{data.schoolAddress}</p>
          )}
          {data.schoolPhone === null ? null : (
            <p className="text-[9px]">Tel: {data.schoolPhone}</p>
          )}
        </div>

        <div className="text-right">
          <p className="border border-black px-2 py-0.5 text-[9px] font-bold tracking-wide">
            {copyLabel}
          </p>
          <p className="mt-1 font-mono text-[10px] font-bold">{data.challanNumber}</p>
        </div>
      </header>

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
        <Field label="Issue date" value={data.issueDate} />
        <Field label="Due date" value={data.dueDate} />
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
              <td className="py-0.5">{item.description}</td>
              <td className="py-0.5 text-right">{formatAmount(item.amount)}</td>
              <td className="py-0.5 text-right">
                {Number(item.concessionAmount) === 0
                  ? '—'
                  : `−${formatAmount(item.concessionAmount)}`}
              </td>
              <td className="py-0.5 text-right">{formatAmount(item.netAmount)}</td>
            </tr>
          ))}

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
          Please pay on or before <span className="font-bold">{data.dueDate}</span>. A
          late payment may attract a surcharge.
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
