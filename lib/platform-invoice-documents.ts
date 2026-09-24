import 'server-only';

import { formatMoneyMinor } from './money';
import { monthLabel, shortDate } from './platform-billing';
import {
  getPlatformInvoiceDetail,
  listPlatformBankAccounts,
  type InvoiceDetail,
} from './platform-billing-queries';
import { renderInvoicePdf, type InvoicePdfData } from './platform-invoice-pdf';

/**
 * An invoice as the documents a person receives — the PDF and its email.
 *
 * One place turns an `InvoiceDetail` into words, so the PDF the super admin
 * downloads, the PDF attached to the email and the PDF a blocked school's
 * administrator downloads from the suspended page are the same document byte
 * for byte, and none of them can drift into saying something the others do not
 * (E6 in particular: none of them says anything about a threshold).
 */

export function pdfDataFor(
  invoice: InvoiceDetail,
  bankAccounts: Awaited<ReturnType<typeof listPlatformBankAccounts>>,
): InvoicePdfData {
  const money = (minor: number) => formatMoneyMinor(minor, invoice.currency);

  const prorationNote =
    invoice.billableDays === invoice.daysInPeriod
      ? null
      : `Billed ${shortDate(invoice.billedFrom)} to ${shortDate(invoice.periodEnd)} ` +
        `(${String(invoice.billableDays)} of ${String(invoice.daysInPeriod)} days).`;

  const conversionNote =
    invoice.conversionRate === null || invoice.billingCurrency === invoice.currency
      ? null
      : `Rates are in ${invoice.billingCurrency}, converted to ${invoice.currency} at ` +
        `${invoice.conversionRate} PKR per USD.`;

  return {
    invoiceNumber: invoice.invoiceNumber,
    issuedOn: shortDate(invoice.createdAt.slice(0, 10)),
    dueDate: shortDate(invoice.dueDate),
    periodLabel: monthLabel(invoice.periodStart),
    prorationNote,
    conversionNote,
    statusLabel: invoice.statusLabel,
    school: {
      name: invoice.school.name,
      address: invoice.school.address,
      city: invoice.school.city,
      email: invoice.school.email,
    },
    lines: invoice.lines.map((line) => ({
      description: line.description,
      quantity: line.kind === 'carry_forward' ? '' : String(line.quantity),
      rate:
        line.kind === 'carry_forward'
          ? ''
          : formatMoneyMinor(line.unitRateMinor, invoice.billingCurrency),
      amount: money(line.amountMinor),
    })),
    subtotal: money(invoice.subtotalMinor),
    discounts: invoice.discounts.map((discount) => ({
      description: discount.description,
      amount: money(discount.amountMinor),
    })),
    total: money(invoice.totalMinor),
    received: money(invoice.receivedMinor),
    balance: money(invoice.balanceMinor),
    bankAccounts: bankAccounts.map((account) => ({
      bankName: account.bankName,
      accountTitle: account.accountTitle,
      accountNumber: account.accountNumber,
      iban: account.iban,
      branch:
        account.branchName === null
          ? account.branchCode
          : account.branchCode === null
            ? account.branchName
            : `${account.branchName} (${account.branchCode})`,
      city: account.city,
    })),
  };
}

export interface InvoiceDocument {
  invoice: InvoiceDetail;
  pdf: Uint8Array;
  filename: string;
}

export async function buildInvoiceDocument(invoiceId: string): Promise<InvoiceDocument | null> {
  const [invoice, bankAccounts] = await Promise.all([
    getPlatformInvoiceDetail(invoiceId),
    listPlatformBankAccounts(),
  ]);
  if (invoice === null) return null;

  const pdf = await renderInvoicePdf(pdfDataFor(invoice, bankAccounts));
  return { invoice, pdf, filename: `${invoice.invoiceNumber}.pdf` };
}

/** The body of the invoice email. Plain text, like every mail here. */
export function invoiceEmailText(invoice: InvoiceDetail): string {
  const money = (minor: number) => formatMoneyMinor(minor, invoice.currency);
  return (
    `Dear ${invoice.school.name},\n\n` +
    `Please find attached SchoolHub invoice ${invoice.invoiceNumber} for ${monthLabel(invoice.periodStart)}.\n\n` +
    `Total: ${money(invoice.totalMinor)}\n` +
    (invoice.receivedMinor > 0 ? `Received: ${money(invoice.receivedMinor)}\n` : '') +
    `Balance: ${money(invoice.balanceMinor)}\n` +
    `Due: ${shortDate(invoice.dueDate)}\n\n` +
    'Payment details are on the invoice. Please quote the invoice number as the reference.\n\n' +
    'Thank you,\nSchoolHub\n'
  );
}

export function pdfResponseHeaders(filename: string, disposition: 'attachment' | 'inline') {
  return {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `${disposition}; filename="${filename.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
    'Cache-Control': 'private, no-store',
  };
}
