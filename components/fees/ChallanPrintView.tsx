'use client';

import { Button } from '@/components/ui/Button';
import { formatPkr, rupeesToWords } from '@/lib/money';

/**
 * The printable challan — three copies on one A4 sheet.
 *
 * ── Why three ────────────────────────────────────────────────────────────
 * This is how fee challans work in Pakistan. A parent takes the sheet to a
 * bank counter; the teller stamps all three, keeps the bank copy, returns the
 * school copy for the child to hand in, and the family keeps the student copy
 * as proof. Printing one copy would break the process on the first day.
 *
 * ── Why no PDF library ───────────────────────────────────────────────────
 * `window.print()` against `@media print` CSS renders identically on every
 * machine a school office actually has, needs no server round trip, and adds
 * nothing to the bundle. A PDF library would buy pixel control nobody here is
 * asking for.
 *
 * The screen view hides the printable block entirely and the print view hides
 * the rest of the page, so the same component serves both without a second
 * route.
 */

export interface ChallanPrintItem {
  description: string;
  amountPaise: number;
  concessionPaise: number;
  netPaise: number;
}

export interface ChallanPrintData {
  challanNumber: string;
  issueDate: string;
  dueDate: string;
  studentName: string;
  studentId: string;
  gradeName: string;
  sectionName: string;
  billingLabel: string;
  academicYearName: string;
  items: readonly ChallanPrintItem[];
  subtotalPaise: number;
  concessionPaise: number;
  lateFeePaise: number;
  totalPaise: number;
  paidPaise: number;
  balancePaise: number;
  schoolName: string;
  schoolLogoUrl: string | null;
  branchName: string | null;
  bankAccountDetails: string | null;
}

const COPIES = ['School Copy', 'Bank Copy', 'Student Copy'] as const;

export function ChallanPrintView({ challan }: { challan: ChallanPrintData }) {
  return (
    <>
      <div className="no-print">
        <Button
          onClick={() => {
            window.print();
          }}
        >
          Print challan
        </Button>
        <p className="mt-2 text-xs text-slate-500">
          Prints three copies on one A4 sheet — school, bank and student.
        </p>
      </div>

      <div className="challan-print" aria-hidden="true">
        {COPIES.map((copy) => (
          <ChallanCopy key={copy} challan={challan} copyLabel={copy} />
        ))}
      </div>

      {/*
        Kept here rather than in globals.css: nothing else in the application
        prints, and a page-wide print rule would be a trap for whoever adds the
        next printable screen. Injected as a plain <style> so it does not depend
        on styled-jsx being active in an App Router client component.
      */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
        .challan-print {
          display: none;
        }

        @media print {
          /* Hide the application shell — sidebar, navbar, buttons. */
          body * {
            visibility: hidden;
          }

          .challan-print,
          .challan-print * {
            visibility: visible;
          }

          .challan-print {
            display: block;
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }

          .no-print {
            display: none !important;
          }

          @page {
            size: A4 portrait;
            margin: 8mm;
          }

          .challan-copy {
            /* Three equal parts of a 297mm page, less margins. */
            height: 92mm;
            box-sizing: border-box;
            padding: 4mm 5mm;
            border-bottom: 1px dashed #94a3b8;
            page-break-inside: avoid;
            font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
            font-size: 9pt;
            color: #000;
          }

          .challan-copy:last-child {
            border-bottom: none;
          }

          .challan-copy table {
            width: 100%;
            border-collapse: collapse;
            font-size: 8.5pt;
          }

          .challan-copy th,
          .challan-copy td {
            border: 1px solid #cbd5e1;
            padding: 1.2mm 2mm;
            text-align: left;
          }

          .challan-copy th {
            background: #f1f5f9;
            font-weight: 600;
          }

          .challan-copy .amount {
            text-align: right;
            font-variant-numeric: tabular-nums;
          }
        }
      `,
        }}
      />
    </>
  );
}

function ChallanCopy({
  challan,
  copyLabel,
}: {
  challan: ChallanPrintData;
  copyLabel: string;
}) {
  return (
    <section className="challan-copy">
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          borderBottom: '1px solid #000',
          paddingBottom: '2mm',
          marginBottom: '2mm',
        }}
      >
        <div style={{ display: 'flex', gap: '3mm', alignItems: 'center' }}>
          {challan.schoolLogoUrl === null || challan.schoolLogoUrl === '' ? null : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={challan.schoolLogoUrl}
              alt=""
              style={{ height: '12mm', width: '12mm', objectFit: 'contain' }}
            />
          )}
          <div>
            <div style={{ fontSize: '12pt', fontWeight: 700 }}>{challan.schoolName}</div>
            {challan.branchName === null ? null : (
              <div style={{ fontSize: '8pt' }}>{challan.branchName}</div>
            )}
            <div style={{ fontSize: '8pt' }}>Fee Challan · {challan.academicYearName}</div>
          </div>
        </div>

        <div style={{ textAlign: 'right' }}>
          <div style={{ fontWeight: 700, fontSize: '10pt' }}>{copyLabel}</div>
          <div style={{ fontFamily: 'monospace', fontSize: '9pt' }}>
            {challan.challanNumber}
          </div>
          <div style={{ fontSize: '8pt' }}>Issued {challan.issueDate}</div>
          <div style={{ fontSize: '8pt', fontWeight: 700 }}>Due {challan.dueDate}</div>
        </div>
      </header>

      <div style={{ display: 'flex', gap: '6mm', marginBottom: '2mm', fontSize: '8.5pt' }}>
        <div>
          <strong>Student:</strong> {challan.studentName}
        </div>
        <div>
          <strong>ID:</strong> {challan.studentId}
        </div>
        <div>
          <strong>Class:</strong> {challan.gradeName} {challan.sectionName}
        </div>
        <div>
          <strong>Period:</strong> {challan.billingLabel}
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th style={{ width: '46%' }}>Particulars</th>
            <th className="amount" style={{ width: '18%' }}>Amount</th>
            <th className="amount" style={{ width: '18%' }}>Concession</th>
            <th className="amount" style={{ width: '18%' }}>Net</th>
          </tr>
        </thead>
        <tbody>
          {challan.items.map((item, index) => (
            <tr key={index}>
              <td>{item.description}</td>
              <td className="amount">{formatPkr(item.amountPaise)}</td>
              <td className="amount">
                {item.concessionPaise === 0 ? '—' : formatPkr(item.concessionPaise)}
              </td>
              <td className="amount">{formatPkr(item.netPaise)}</td>
            </tr>
          ))}

          {challan.lateFeePaise > 0 ? (
            <tr>
              <td>Late fee</td>
              <td className="amount">—</td>
              <td className="amount">—</td>
              <td className="amount">{formatPkr(challan.lateFeePaise)}</td>
            </tr>
          ) : null}

          <tr>
            <th colSpan={3} style={{ textAlign: 'right' }}>
              Total payable
            </th>
            <th className="amount">{formatPkr(challan.totalPaise)}</th>
          </tr>

          {challan.paidPaise > 0 ? (
            <tr>
              <th colSpan={3} style={{ textAlign: 'right' }}>
                Already paid
              </th>
              <th className="amount">{formatPkr(challan.paidPaise)}</th>
            </tr>
          ) : null}

          {challan.paidPaise > 0 ? (
            <tr>
              <th colSpan={3} style={{ textAlign: 'right' }}>
                Balance
              </th>
              <th className="amount">{formatPkr(challan.balancePaise)}</th>
            </tr>
          ) : null}
        </tbody>
      </table>

      <div style={{ marginTop: '1.5mm', fontSize: '8pt' }}>
        <strong>Amount in words:</strong> Rupees{' '}
        {rupeesToWords(challan.balancePaise > 0 ? challan.balancePaise : challan.totalPaise)}
      </div>

      <div
        style={{
          marginTop: '2mm',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          fontSize: '7.5pt',
        }}
      >
        <div style={{ maxWidth: '60%' }}>
          <strong>Deposit instructions:</strong>{' '}
          {challan.bankAccountDetails === null || challan.bankAccountDetails === ''
            ? 'Payable at the school office or the school’s designated bank branch.'
            : challan.bankAccountDetails}
        </div>
        <div style={{ textAlign: 'center', minWidth: '35mm' }}>
          <div style={{ borderTop: '1px solid #000', paddingTop: '1mm' }}>
            Cashier / Bank Stamp
          </div>
        </div>
      </div>
    </section>
  );
}
