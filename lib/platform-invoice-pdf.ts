import 'server-only';

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

import { SCHOOLHUB_LOGO_PNG_BASE64, SCHOOLHUB_LOGO_SIZE } from './brand-assets-data';
import { PLATFORM_SUPPORT_EMAIL } from './platform-contact';

/**
 * The platform invoice as a PDF — Sprint 35, E12.
 *
 * ── Why pdf-lib, when the rest of the product prints through the browser ──
 * Every school document — the fee voucher, the report card, the payslip — is a
 * `PrintSheet` the browser prints, and STATE.md is emphatic that there is no PDF
 * library and no headless Chromium because Hostinger cannot run the latter.
 * This document is different in the one way that matters: it has to be
 * **attached to an email** sent by the server, and a browser print dialog
 * cannot attach anything. `pdf-lib` is pure JavaScript — no Chromium, no
 * native binary, nothing for Hostinger to refuse — which is why the spec names
 * it, and why it is used here and nowhere else.
 *
 * ── What is on it, and what is deliberately not ──────────────────────────
 * Logo, invoice number, the school, the period, the lines, the discounts, the
 * total, what has been received, the balance, the due date, and the platform's
 * bank accounts. **Not** any statement of how much must be paid for the school
 * to stay open (E6): "Received" and "Balance" are facts about money; a
 * threshold is a policy, and it stays on the server.
 *
 * ── The standard fonts speak WinAnsi only ────────────────────────────────
 * Helvetica embedded by pdf-lib cannot draw an arrow or an Urdu name, and asks
 * for one by throwing. `printable` below maps the typographic characters this
 * codebase actually writes and replaces anything else, so a school called
 * something no Western font can spell still gets an invoice rather than a 500.
 */

export interface InvoicePdfLine {
  description: string;
  quantity: string;
  rate: string;
  amount: string;
}

export interface InvoicePdfBankAccount {
  bankName: string;
  accountTitle: string;
  accountNumber: string;
  iban: string;
  branch: string | null;
  city: string | null;
}

export interface InvoicePdfData {
  invoiceNumber: string;
  issuedOn: string;
  dueDate: string;
  periodLabel: string;
  /** "Billed 21–31 Oct 2026 (11 of 31 days)", or null for a whole month. */
  prorationNote: string | null;
  /** "Converted from USD at 280.0000 PKR per USD", or null. */
  conversionNote: string | null;
  statusLabel: string;
  school: { name: string; address: string | null; city: string; email: string | null };
  lines: readonly InvoicePdfLine[];
  subtotal: string;
  discounts: readonly { description: string; amount: string }[];
  total: string;
  received: string;
  balance: string;
  bankAccounts: readonly InvoicePdfBankAccount[];
}

const INK = rgb(0.09, 0.11, 0.16);
const MUTED = rgb(0.4, 0.44, 0.5);
const RULE = rgb(0.85, 0.87, 0.9);
const ACCENT = rgb(0.1, 0.36, 0.7);

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;

const TYPOGRAPHIC: Record<string, string> = {
  '→': '->',
  '←': '<-',
  '−': '-',
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
  '×': 'x',
};

/** Characters WinAnsi can draw beyond Latin-1. */
const WIN_ANSI_EXTRAS = new Set('–—‘’“”•…€');

export function printable(text: string): string {
  let out = '';
  for (const character of text) {
    const mapped = TYPOGRAPHIC[character];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    const code = character.codePointAt(0) ?? 63;
    if ((code >= 32 && code <= 126) || (code >= 160 && code <= 255) || WIN_ANSI_EXTRAS.has(character)) {
      out += character;
    } else if (code === 10) {
      out += ' ';
    } else {
      out += '?';
    }
  }
  return out;
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = printable(text).split(/\s+/).filter((word) => word !== '');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (font.widthOfTextAtSize(candidate, size) <= width || current === '') {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== '') lines.push(current);
  return lines.length === 0 ? [''] : lines;
}

interface Pen {
  page: PDFPage;
  y: number;
}

export async function renderInvoicePdf(data: InvoicePdfData): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.setTitle(`${data.invoiceNumber} — SchoolHub`);
  document.setAuthor('SchoolHub');
  document.setProducer('SchoolHub');
  document.setCreator('SchoolHub');

  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const logo = await document.embedPng(Buffer.from(SCHOOLHUB_LOGO_PNG_BASE64, 'base64'));

  const pen: Pen = { page: document.addPage([PAGE_WIDTH, PAGE_HEIGHT]), y: PAGE_HEIGHT - MARGIN };

  const text = (
    value: string,
    x: number,
    options: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; alignRight?: number } = {},
  ) => {
    const size = options.size ?? 10;
    const font = options.font ?? regular;
    const safe = printable(value);
    const drawX =
      options.alignRight === undefined ? x : options.alignRight - font.widthOfTextAtSize(safe, size);
    pen.page.drawText(safe, { x: drawX, y: pen.y, size, font, color: options.color ?? INK });
  };

  const ensureRoom = (needed: number) => {
    if (pen.y - needed >= MARGIN + 30) return;
    pen.page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pen.y = PAGE_HEIGHT - MARGIN;
  };

  const rule = () => {
    pen.page.drawLine({
      start: { x: MARGIN, y: pen.y },
      end: { x: PAGE_WIDTH - MARGIN, y: pen.y },
      thickness: 0.75,
      color: RULE,
    });
  };

  /* ── header ─────────────────────────────────────────────────────────── */
  const logoWidth = 150;
  const logoHeight = (logoWidth * SCHOOLHUB_LOGO_SIZE.height) / SCHOOLHUB_LOGO_SIZE.width;
  pen.page.drawImage(logo, {
    x: MARGIN,
    y: pen.y - logoHeight,
    width: logoWidth,
    height: logoHeight,
  });

  const right = PAGE_WIDTH - MARGIN;
  pen.y -= 14;
  text('INVOICE', 0, { size: 18, font: bold, color: ACCENT, alignRight: right });
  pen.y -= 18;
  text(data.invoiceNumber, 0, { size: 11, font: bold, alignRight: right });
  pen.y -= 14;
  text(`Issued ${data.issuedOn}`, 0, { size: 9, color: MUTED, alignRight: right });
  pen.y -= 12;
  text(`Due ${data.dueDate}`, 0, { size: 9, font: bold, alignRight: right });
  pen.y -= 12;
  text(data.statusLabel, 0, { size: 9, color: MUTED, alignRight: right });

  pen.y = Math.min(pen.y, PAGE_HEIGHT - MARGIN - logoHeight) - 28;

  /* ── bill to / period ───────────────────────────────────────────────── */
  const columnTwo = PAGE_WIDTH / 2 + 10;
  const blockTop = pen.y;

  text('BILLED TO', MARGIN, { size: 8, font: bold, color: MUTED });
  pen.y -= 14;
  for (const line of wrap(data.school.name, bold, 11, columnTwo - MARGIN - 20)) {
    text(line, MARGIN, { size: 11, font: bold });
    pen.y -= 14;
  }
  if (data.school.address !== null && data.school.address !== '') {
    for (const line of wrap(data.school.address, regular, 9, columnTwo - MARGIN - 20)) {
      text(line, MARGIN, { size: 9, color: MUTED });
      pen.y -= 12;
    }
  }
  text(data.school.city, MARGIN, { size: 9, color: MUTED });
  pen.y -= 12;
  if (data.school.email !== null && data.school.email !== '') {
    text(data.school.email, MARGIN, { size: 9, color: MUTED });
    pen.y -= 12;
  }
  const leftBottom = pen.y;

  pen.y = blockTop;
  text('BILLING PERIOD', columnTwo, { size: 8, font: bold, color: MUTED });
  pen.y -= 14;
  text(data.periodLabel, columnTwo, { size: 11, font: bold });
  pen.y -= 14;
  for (const note of [data.prorationNote, data.conversionNote]) {
    if (note === null) continue;
    for (const line of wrap(note, regular, 9, right - columnTwo)) {
      text(line, columnTwo, { size: 9, color: MUTED });
      pen.y -= 12;
    }
  }

  pen.y = Math.min(pen.y, leftBottom) - 20;

  /* ── lines ──────────────────────────────────────────────────────────── */
  const qtyRight = 360;
  const rateRight = 450;
  const descriptionWidth = 250;

  text('DESCRIPTION', MARGIN, { size: 8, font: bold, color: MUTED });
  text('QTY', 0, { size: 8, font: bold, color: MUTED, alignRight: qtyRight });
  text('RATE', 0, { size: 8, font: bold, color: MUTED, alignRight: rateRight });
  text('AMOUNT', 0, { size: 8, font: bold, color: MUTED, alignRight: right });
  pen.y -= 8;
  rule();
  pen.y -= 16;

  if (data.lines.length === 0) {
    text('Nothing is billable for this period.', MARGIN, { size: 10, color: MUTED });
    pen.y -= 18;
  }

  for (const line of data.lines) {
    const wrapped = wrap(line.description, regular, 10, descriptionWidth);
    ensureRoom(wrapped.length * 13 + 10);
    text(line.quantity, 0, { size: 10, alignRight: qtyRight });
    text(line.rate, 0, { size: 10, alignRight: rateRight });
    text(line.amount, 0, { size: 10, alignRight: right });
    for (const part of wrapped) {
      text(part, MARGIN, { size: 10 });
      pen.y -= 13;
    }
    pen.y -= 5;
  }

  rule();
  pen.y -= 18;

  /* ── totals ─────────────────────────────────────────────────────────── */
  const totalLabelX = 330;
  const totalRow = (label: string, value: string, emphasis = false) => {
    ensureRoom(18);
    text(label, totalLabelX, { size: emphasis ? 11 : 10, font: emphasis ? bold : regular });
    text(value, 0, { size: emphasis ? 11 : 10, font: emphasis ? bold : regular, alignRight: right });
    pen.y -= emphasis ? 18 : 15;
  };

  totalRow('Subtotal', data.subtotal);
  for (const discount of data.discounts) {
    // One line in the totals column; a description that does not fit ends in an
    // ellipsis rather than stopping mid-sentence as if that were all of it.
    const width = rateRight - totalLabelX;
    const lines = wrap(`Discount: ${discount.description}`, regular, 10, width);
    let label = lines[0] ?? '';
    if (lines.length > 1) {
      while (label.length > 0 && regular.widthOfTextAtSize(`${label}…`, 10) > width) {
        label = label.slice(0, -1);
      }
      label = `${label.trimEnd()}…`;
    }
    totalRow(label, `-${discount.amount}`);
  }
  totalRow('Total', data.total, true);
  totalRow('Received', data.received);
  totalRow('Balance', data.balance, true);

  pen.y -= 16;

  /* ── how to pay ─────────────────────────────────────────────────────── */
  ensureRoom(60);
  text('HOW TO PAY', MARGIN, { size: 8, font: bold, color: MUTED });
  pen.y -= 14;

  if (data.bankAccounts.length === 0) {
    text(`Contact SchoolHub at ${PLATFORM_SUPPORT_EMAIL} for payment details.`, MARGIN, { size: 10, color: MUTED });
    pen.y -= 14;
  } else {
    text(
      `Please pay by bank transfer and quote ${data.invoiceNumber} as the reference.`,
      MARGIN,
      { size: 9, color: MUTED },
    );
    pen.y -= 16;

    for (const account of data.bankAccounts) {
      ensureRoom(70);
      text(account.bankName, MARGIN, { size: 10, font: bold });
      pen.y -= 13;
      text(`Account title: ${account.accountTitle}`, MARGIN, { size: 9 });
      pen.y -= 12;
      text(`Account number: ${account.accountNumber}`, MARGIN, { size: 9 });
      pen.y -= 12;
      text(`IBAN: ${account.iban}`, MARGIN, { size: 9, font: bold });
      pen.y -= 12;
      const branch = [account.branch, account.city].filter((part) => part !== null && part !== '').join(', ');
      if (branch !== '') {
        text(branch, MARGIN, { size: 9, color: MUTED });
        pen.y -= 12;
      }
      pen.y -= 8;
    }
  }

  /* ── footer on every page ───────────────────────────────────────────── */
  for (const page of document.getPages()) {
    page.drawText(printable(`SchoolHub · ${data.invoiceNumber}`), {
      x: MARGIN,
      y: MARGIN - 20,
      size: 8,
      font: regular,
      color: MUTED,
    });
  }

  return document.save();
}
