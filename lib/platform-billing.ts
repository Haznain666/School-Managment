/**
 * Platform billing — the arithmetic, with nothing that reads a database.
 *
 * Sprint 35. What a school owes the platform each month, and every rule that
 * decides it. Kept free of `server-only`, drizzle and the clock so three very
 * different callers can share one copy: the invoice generator, the Billing tab
 * (which shows the same estimate in the browser before anything is saved), and
 * `check-sprint35`, which asserts the rules directly rather than trusting a
 * screen that happens to agree with them today.
 *
 * ── Money is integer minor units, everywhere in here ─────────────────────
 * US cents and PKR paisa (E1). `lib/money.ts` says why at length for the fee
 * module and it applies unchanged: a double cannot hold 0.10, and an invoice
 * that is out by a cent is an invoice a school disputes. The columns are
 * NUMERIC(14,2) and reach this file through `toPaise`, which is currency-blind —
 * it multiplies by one hundred, which is right for both.
 *
 * ── Dates are `YYYY-MM-DD` strings, never `Date` ─────────────────────────
 * Every date here is a calendar day in Asia/Karachi. A `Date` is an instant,
 * and the difference is exactly the five hours that made `timetableToday()`
 * open a day late every night (STATE.md §5ci). The arithmetic below is done on
 * UTC midnights purely as a day counter; nothing in this file ever asks what
 * time it is.
 *
 * ── What is deliberately NOT in this file ────────────────────────────────
 * The clearing threshold. It lives in `lib/platform-invoice-clearing.ts`, which
 * is `server-only`, because this module is imported by a client component and
 * anything here ends up in a JavaScript bundle a school administrator can read.
 * E6 says the threshold is never shown on any screen, and "it was only in the
 * minified source" is not a defence anybody wants to make.
 */

/** The two currencies the platform bills in. */
export const BILLING_CURRENCIES = ['USD', 'PKR'] as const;
export type BillingCurrency = (typeof BILLING_CURRENCIES)[number];

export function isBillingCurrency(value: unknown): value is BillingCurrency {
  return value === 'USD' || value === 'PKR';
}

/** Sandbox schools are never invoiced, reminded or blocked (E8). */
export const BILLING_ENVIRONMENTS = ['sandbox', 'live'] as const;
export type BillingEnvironment = (typeof BILLING_ENVIRONMENTS)[number];

/**
 * The lifecycle of an invoice.
 *
 * `overdue` is not here on purpose: it is `finalized` plus the date, and
 * storing it would give the sweep a second column to keep in step with the
 * calendar. The status chip derives it — see `invoiceDisplayStatus`.
 */
export const INVOICE_STATUSES = ['draft', 'finalized', 'paid', 'carried_forward'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** What a chip says. Never "partial" — see E6. */
export type InvoiceDisplayStatus = 'draft' | 'due' | 'overdue' | 'paid' | 'carried_forward';

export const INVOICE_DISPLAY_LABELS: Record<InvoiceDisplayStatus, string> = {
  draft: 'Draft',
  due: 'Finalized (Due)',
  overdue: 'Overdue',
  paid: 'Paid',
  carried_forward: 'Carried forward',
};

/** Days of grace after the due date, unless a school has its own. */
export const DEFAULT_GRACE_DAYS = 2;

/** The day of the month an invoice falls due (E5). */
export const INVOICE_DUE_DAY = 10;

/** At most this many discounts per invoice (E10). */
export const MAX_DISCOUNTS_PER_INVOICE = 3;

/** At most this many platform bank accounts (§5). */
export const MAX_PLATFORM_BANK_ACCOUNTS = 3;

/** A trial longer than a year is a typo, not a trial. */
export const MAX_TRIAL_DAYS = 365;

/** Grace longer than two months is not grace. */
export const MAX_GRACE_DAYS = 60;

/* ═══════════════════════════════════════════════════════════════ dates */

const DAY_MS = 24 * 60 * 60 * 1000;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = ISO_DATE.exec(value);
  if (match === null) return false;
  const [, y, m, d] = match;
  const at = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return at.toISOString().slice(0, 10) === value;
}

/** A calendar day as a day number. Only ever used as a counter. */
function dayNumber(iso: string): number {
  const match = ISO_DATE.exec(iso);
  if (match === null) throw new Error(`Not a calendar date: ${iso}`);
  const [, y, m, d] = match;
  return Date.UTC(Number(y), Number(m) - 1, Number(d)) / DAY_MS;
}

function fromDayNumber(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  return fromDayNumber(dayNumber(iso) + days);
}

/** Inclusive count of days from `from` to `to`. Zero or less when reversed. */
export function daysInclusive(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from) + 1;
}

export function compareDates(a: string, b: string): number {
  return dayNumber(a) - dayNumber(b);
}

export function maxDate(...dates: readonly string[]): string {
  return dates.reduce((best, next) => (compareDates(next, best) > 0 ? next : best));
}

/** The number of days in the month `iso` falls in. February included. */
export function daysInMonth(iso: string): number {
  const match = ISO_DATE.exec(iso);
  if (match === null) throw new Error(`Not a calendar date: ${iso}`);
  const [, y, m] = match;
  return new Date(Date.UTC(Number(y), Number(m), 0)).getUTCDate();
}

export function firstOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function lastOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-${String(daysInMonth(iso)).padStart(2, '0')}`;
}

/** The calendar month before the one `iso` falls in. */
export function previousMonth(iso: string): { start: string; end: string } {
  const start = firstOfMonth(addDays(firstOfMonth(iso), -1));
  return { start, end: lastOfMonth(start) };
}

/**
 * Today in Asia/Karachi.
 *
 * Pakistan has no daylight saving, so this is UTC+5 all year; `Intl` is used
 * anyway because it is the form a reader recognises and it costs nothing. The
 * instant is a parameter so the sweep and the check script can both pass one.
 */
export function karachiToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** "October 2026", for invoice lines and email subjects. */
export function monthLabel(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(new Date(dayNumber(firstOfMonth(iso)) * DAY_MS));
}

/** "13 Nov 2026". */
export function shortDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(dayNumber(iso) * DAY_MS));
}

/* ═══════════════════════════════════════════════════════ trial and dates */

/**
 * The last free day of a trial (E4).
 *
 * N days starting on the day the school went Live, so the last free day is
 * `live_since + N − 1`. Zero days is no trial at all, and returns null rather
 * than the day before going live — a null is a question nobody can misread.
 */
export function trialEndsOn(liveSince: string | null, trialDays: number): string | null {
  if (liveSince === null || trialDays <= 0) return null;
  return addDays(liveSince, trialDays - 1);
}

/**
 * The due date of the invoice for a billed month (E5).
 *
 * "The 10th of the month the invoice is generated in." Invoices are generated
 * in arrears, on the 1st of the month *after* the one they bill, so this is the
 * 10th of the following month — derived from the period rather than from the
 * clock, so an invoice generated late by "Generate now" carries the same due
 * date the sweep would have given it, and two operators pressing the button on
 * different days cannot produce two different answers for one month.
 */
export function dueDateForPeriod(periodStart: string): string {
  const next = addDays(lastOfMonth(periodStart), 1);
  return `${next.slice(0, 7)}-${String(INVOICE_DUE_DAY).padStart(2, '0')}`;
}

/**
 * The first calendar day on which a school with this invoice unpaid is blocked.
 *
 * Due on the 10th with two days' grace: the 11th and 12th are grace, and the
 * school is blocked from 00:00 Karachi time on the **13th**.
 */
export function blockingStartsOn(dueDate: string, graceDays: number): string {
  return addDays(dueDate, Math.max(0, graceDays) + 1);
}

/** Is `today` on or after the blocking day? */
export function isPastGrace(dueDate: string, graceDays: number, today: string): boolean {
  return compareDates(today, blockingStartsOn(dueDate, graceDays)) >= 0;
}

/* ═══════════════════════════════════════════════════════════ proration */

export interface BillablePeriod {
  /** First billable day, inclusive. */
  from: string;
  /** Last billable day, inclusive. Always the end of the month. */
  to: string;
  billableDays: number;
  daysInMonth: number;
}

/**
 * Which days of a month a school pays for (E3).
 *
 * From the latest of: the first of the month, the day the school went Live,
 * and the day after its trial ends — to the last day of the month, inclusive.
 * Null when that leaves nothing, which is the "no invoice this month" answer
 * and not a zero-value invoice.
 *
 * The brief's own example — a trial whose last free day is 20 October — bills
 * 21 to 31 October, which is **eleven** days. The brief said ten; 31 − 20 is
 * ten, but both ends are billed. `SPRINT-35-SPEC.md` records the decision and
 * `check-sprint35` asserts it, so nobody "fixes" it back.
 */
export function billablePeriod(
  periodStart: string,
  liveSince: string | null,
  trialLastDay: string | null,
): BillablePeriod | null {
  if (liveSince === null) return null;

  const monthStart = firstOfMonth(periodStart);
  const monthEnd = lastOfMonth(periodStart);

  const candidates = [monthStart, liveSince];
  if (trialLastDay !== null) candidates.push(addDays(trialLastDay, 1));

  const from = maxDate(...candidates);
  const billableDays = daysInclusive(from, monthEnd);
  if (billableDays <= 0) return null;

  return { from, to: monthEnd, billableDays, daysInMonth: daysInMonth(monthStart) };
}

/**
 * `monthly × days / daysInMonth`, rounded half-up to the minor unit.
 *
 * Integer arithmetic throughout: `floor((2·m·d + D) / 2D)` is round-half-up
 * for non-negative operands without ever forming a fraction. `Math.round` on a
 * quotient would do the same *usually*, and "usually" is the word a school
 * disputing a cent does not want to hear.
 */
export function prorate(monthlyMinor: number, billableDays: number, monthDays: number): number {
  if (monthlyMinor <= 0 || billableDays <= 0 || monthDays <= 0) return 0;
  if (billableDays >= monthDays) return monthlyMinor;
  return Math.floor((2 * monthlyMinor * billableDays + monthDays) / (2 * monthDays));
}

/* ═══════════════════════════════════════════════════════════ currency */

/**
 * A USD→PKR rate held as an integer number of ten-thousandths.
 *
 * The column is NUMERIC(12,4) — PKR per 1 USD — and arrives as a string.
 * Parsing it once into an integer is what lets the conversion below stay in
 * whole numbers.
 */
export function rateToUnits(rate: string | number | null | undefined): number | null {
  if (rate === null || rate === undefined || rate === '') return null;
  const numeric = typeof rate === 'number' ? rate : Number.parseFloat(rate);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.round(numeric * 10_000);
}

/**
 * Converts minor units between currencies.
 *
 * One cent is 0.01 USD, which is `rate` × 0.01 PKR, which is `rate` paisa — so
 * cents × rate = paisa, and the division by 10,000 only undoes the units the
 * rate was stored in. Rounded half-up, once, at the end.
 */
export function convertMinor(
  amountMinor: number,
  from: BillingCurrency,
  to: BillingCurrency,
  rateUnits: number | null,
): number {
  if (from === to || amountMinor === 0) return amountMinor;
  if (rateUnits === null || rateUnits <= 0) {
    throw new Error(`A USD→PKR rate is required to convert ${from} to ${to}.`);
  }

  const sign = amountMinor < 0 ? -1 : 1;
  const magnitude = Math.abs(amountMinor);

  const converted =
    from === 'USD'
      ? Math.floor((2 * magnitude * rateUnits + 10_000) / 20_000)
      : Math.floor((2 * magnitude * 10_000 + rateUnits) / (2 * rateUnits));

  return sign * converted;
}

/* ═══════════════════════════════════════════════════════════ discounts */

export type DiscountKind = 'percent' | 'fixed';

export interface DiscountInput {
  kind: DiscountKind;
  /** Basis points for `percent` (1–10,000), minor units for `fixed`. */
  value: number;
}

/**
 * What each discount takes off, in order, and the total (E10).
 *
 * A percentage is of the subtotal **before any discount**, not of what the
 * previous discount left — two 10% discounts are 20%, which is what an operator
 * typing them expects, and not 19%. Each line is capped at what is left, so the
 * total can never exceed the subtotal and an invoice can never go negative.
 */
export function applyDiscounts(
  subtotalMinor: number,
  discounts: readonly DiscountInput[],
): { amounts: number[]; totalDiscount: number; total: number } {
  let remaining = Math.max(0, subtotalMinor);
  const amounts: number[] = [];

  for (const discount of discounts) {
    const raw =
      discount.kind === 'percent'
        ? Math.floor((2 * Math.max(0, subtotalMinor) * discount.value + 10_000) / 20_000)
        : discount.value;
    const amount = Math.max(0, Math.min(raw, remaining));
    amounts.push(amount);
    remaining -= amount;
  }

  const totalDiscount = amounts.reduce((sum, amount) => sum + amount, 0);
  return { amounts, totalDiscount, total: Math.max(0, subtotalMinor) - totalDiscount };
}

/** Basis points as a person reads them: `1250` → `12.5%`. */
export function formatBasisPoints(basisPoints: number): string {
  const whole = Math.trunc(basisPoints / 100);
  const fraction = Math.abs(basisPoints % 100);
  if (fraction === 0) return `${String(whole)}%`;
  return `${String(whole)}.${String(fraction).padStart(2, '0').replace(/0$/, '')}%`;
}

/** A discount as it is typed: a problem sentence, or null. */
export function discountProblem(kind: unknown, value: unknown, description: unknown): string | null {
  if (kind !== 'percent' && kind !== 'fixed') return 'Choose a percentage or a fixed amount.';
  if (typeof description !== 'string' || description.trim() === '') {
    return 'Every discount needs a description.';
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return kind === 'percent' ? 'Enter a percentage above zero.' : 'Enter an amount above zero.';
  }
  if (kind === 'percent' && value > 10_000) return 'A percentage cannot exceed 100.';
  return null;
}

/* ═══════════════════════════════════════════════════════════ estimate */

export interface RoleCount {
  role: string;
  count: number;
}

export interface RateLine {
  key: string;
  label: string;
  quantity: number;
  unitMinor: number;
  amountMinor: number;
}

/**
 * The monthly estimate on the Billing tab: every priced role × its live count,
 * plus every priced module. In the billing currency, for a whole month.
 *
 * The spec's own example must reproduce: 1 + 1 + 2 + 8 + 100 people at USD 1
 * and Chat at USD 50 is **USD 162.00**. `check-sprint35` asserts it.
 */
export function monthlyEstimate(
  roles: readonly { role: string; label: string; count: number; rateMinor: number }[],
  modules: readonly { key: string; label: string; rateMinor: number }[],
): { lines: RateLine[]; totalMinor: number } {
  const lines: RateLine[] = [];

  for (const role of roles) {
    if (role.rateMinor <= 0 || role.count <= 0) continue;
    lines.push({
      key: `role:${role.role}`,
      label: role.label,
      quantity: role.count,
      unitMinor: role.rateMinor,
      amountMinor: role.count * role.rateMinor,
    });
  }

  for (const entry of modules) {
    if (entry.rateMinor <= 0) continue;
    lines.push({
      key: `module:${entry.key}`,
      label: entry.label,
      quantity: 1,
      unitMinor: entry.rateMinor,
      amountMinor: entry.rateMinor,
    });
  }

  return { lines, totalMinor: lines.reduce((sum, line) => sum + line.amountMinor, 0) };
}

/* ═══════════════════════════════════════════════════════════ numbering */

/**
 * `INV-202610-BEACONHOUSE`.
 *
 * Derived, not sequenced: one invoice per school per month is already a unique
 * index, and the slug is unique, so the pair names exactly one invoice and a
 * retried generation cannot mint a second number for the same month. A counter
 * would need a row of its own and a lock, to buy a number that means less.
 */
export function invoiceNumberFor(periodStart: string, slug: string): string {
  const month = periodStart.slice(0, 7).replace('-', '');
  const code = slug.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return `INV-${month}-${code}`;
}

/* ═══════════════════════════════════════════════════════════ display */

/**
 * The chip an invoice wears. `today` in Karachi.
 *
 * Overdue is a finalized invoice past its due date — not past grace. The school
 * is not blocked yet during grace, but the invoice is late, and saying "Due"
 * the day after the due date would be a small lie on the one screen the
 * operator uses to chase money.
 */
export function invoiceDisplayStatus(
  status: InvoiceStatus,
  dueDate: string,
  today: string,
): InvoiceDisplayStatus {
  if (status === 'draft') return 'draft';
  if (status === 'paid') return 'paid';
  if (status === 'carried_forward') return 'carried_forward';
  return compareDates(today, dueDate) > 0 ? 'overdue' : 'due';
}

/* ═══════════════════════════════════════════════════════════ bank accounts */

/**
 * A Pakistani IBAN: `PK`, two check digits, four letters of bank code, then
 * sixteen account characters — 24 in all ("PK + 22"). Spaces are allowed on
 * the way in and removed.
 *
 * The ISO 13616 mod-97 check is run as well as the shape: a transposed digit in
 * an IBAN printed on every invoice is a payment that lands nowhere, and the
 * shape alone cannot see one.
 */
export function normalizeIban(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

export function ibanProblem(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return 'Enter the IBAN.';
  const iban = normalizeIban(value);
  if (!/^PK\d{2}[A-Z]{4}[A-Z0-9]{16}$/.test(iban)) {
    return 'A Pakistani IBAN is PK followed by 22 characters, e.g. PK36SCBL0000001123456702.';
  }

  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`;
  let remainder = 0;
  for (const character of rearranged) {
    const digits = /[A-Z]/.test(character)
      ? String(character.charCodeAt(0) - 55)
      : character;
    for (const digit of digits) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }

  return remainder === 1 ? null : 'That IBAN fails its check digits — re-read it from the bank letter.';
}
