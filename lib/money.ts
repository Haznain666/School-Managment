/**
 * Money handling for the Fee Management module.
 *
 * ── Why paise, and why strings ───────────────────────────────────────────
 * Fees are money, and money must not touch a JavaScript float. `0.1 + 0.2` is
 * `0.30000000000000004`, and a school reconciling a challan against a bank
 * deposit will notice. Every amount therefore lives in one of two forms and
 * never in a third:
 *
 *   - **In the database**: `NUMERIC(10,2)`, which Postgres stores exactly.
 *     Drizzle hands these to us as *strings*, deliberately — it will not
 *     silently parse them into a lossy `number`.
 *   - **In application arithmetic**: integer **paise** (1 rupee = 100 paise),
 *     which is exact in JS up to 2^53, i.e. ~90 trillion rupees.
 *
 * The rule for this module: parse a DB string into paise, do all arithmetic in
 * paise, format back to a `NUMERIC`-safe string on the way out. Nothing else
 * multiplies or adds money.
 *
 * This module is intentionally dependency-free and safe to import from client
 * components, so a form previewing a total computes it the same way the server
 * will.
 */

/** An integer number of paise. Negative is allowed; callers decide validity. */
export type Paise = number;

const PAISE_PER_RUPEE = 100;

/** Largest amount representable in NUMERIC(10,2): 99,999,999.99. */
export const MAX_AMOUNT_PAISE: Paise = 9_999_999_999;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/**
 * Parses a `NUMERIC` string (or a plain rupee string typed by a user) into
 * paise. Returns null for anything that is not a well-formed amount, so
 * callers can turn that into a 400 rather than a NaN that spreads.
 *
 * Accepts `1234`, `1234.5`, `1234.50`, ` 1,234.50 `. Rejects everything else.
 */
export function parsePaise(input: string | number | null | undefined): Paise | null {
  if (input === null || input === undefined) return null;

  const text = String(input).trim().replace(/,/g, '');
  if (text === '') return null;

  // Digits, optional single decimal point, at most two decimal places.
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (match === null) return null;

  const sign = match[1] === '-' ? -1 : 1;
  const whole = Number.parseInt(match[2] ?? '0', 10);
  // '.5' means fifty paise, not five — pad on the right, not the left.
  const fraction = Number.parseInt((match[3] ?? '').padEnd(2, '0'), 10);

  if (!Number.isFinite(whole) || !Number.isFinite(fraction)) return null;

  const paise = sign * (whole * PAISE_PER_RUPEE + fraction);
  return Number.isSafeInteger(paise) ? paise : null;
}

/**
 * Same, but throws. Use where a malformed amount means the caller has a bug
 * rather than a user typing badly — e.g. reading a column we wrote ourselves.
 */
export function requirePaise(input: string | number | null | undefined): Paise {
  const paise = parsePaise(input);
  if (paise === null) {
    throw new MoneyError(`Not a valid amount: ${String(input)}`);
  }
  return paise;
}

/** Reads a nullable DB column, treating null/absent as zero. */
export function paiseOrZero(input: string | number | null | undefined): Paise {
  return parsePaise(input) ?? 0;
}

/**
 * Formats paise as the string a `NUMERIC(10,2)` column expects: `1234.50`.
 * Never locale-formatted — this is a storage format, not a display one.
 */
export function paiseToNumericString(paise: Paise): string {
  if (!Number.isSafeInteger(paise)) {
    throw new MoneyError(`Cannot store a non-integer paise value: ${paise}`);
  }

  const negative = paise < 0;
  const absolute = Math.abs(paise);
  const rupees = Math.floor(absolute / PAISE_PER_RUPEE);
  const fraction = absolute % PAISE_PER_RUPEE;

  return `${negative ? '-' : ''}${rupees}.${String(fraction).padStart(2, '0')}`;
}

/** Display form with thousands separators: `1,234.50`. For UI only. */
export function formatPkr(paise: Paise): string {
  const negative = paise < 0;
  const absolute = Math.abs(paise);
  const rupees = Math.floor(absolute / PAISE_PER_RUPEE);
  const fraction = absolute % PAISE_PER_RUPEE;

  const grouped = String(rupees).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}.${String(fraction).padStart(2, '0')}`;
}

/** `PKR 1,234.50` — the form used on screen and on challans. */
export function formatPkrLabel(paise: Paise): string {
  return `PKR ${formatPkr(paise)}`;
}

/**
 * Applies a percentage discount, rounding half up to the nearest paisa.
 *
 * Rounding has to be decided rather than inherited: a 33% concession on
 * PKR 1000 is 330 exactly, but on PKR 1001 it is 330.33, and the half-up rule
 * is what Pakistani schools use on printed challans.
 */
export function percentageOf(paise: Paise, percent: number): Paise {
  if (!Number.isFinite(percent)) {
    throw new MoneyError(`Not a valid percentage: ${percent}`);
  }

  const clamped = Math.min(Math.max(percent, 0), 100);
  // Scale by 10000 so the percentage's own two decimals stay exact.
  const scaled = Math.round((paise * clamped * 100) / 10000);
  return scaled;
}

/** Sums paise amounts. Exists so no call site hand-rolls a reduce over money. */
export function sumPaise(amounts: readonly Paise[]): Paise {
  return amounts.reduce((total, amount) => total + amount, 0);
}

/** Clamps to a floor of zero — a concession must never make a fee negative. */
export function atLeastZero(paise: Paise): Paise {
  return paise < 0 ? 0 : paise;
}

// -----------------------------------------------------------------------------
// Amount in words — printed on every challan
// -----------------------------------------------------------------------------

const ONES: readonly string[] = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
];

const TENS: readonly string[] = [
  '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty',
  'Ninety',
];

/** 0-99. */
function twoDigitsToWords(value: number): string {
  if (value < 20) return ONES[value] ?? '';

  const tens = TENS[Math.floor(value / 10)] ?? '';
  const ones = ONES[value % 10] ?? '';
  return ones === '' ? tens : `${tens} ${ones}`;
}

/** 0-999. */
function threeDigitsToWords(value: number): string {
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;

  const parts: string[] = [];
  if (hundreds > 0) parts.push(`${ONES[hundreds] ?? ''} Hundred`);
  if (rest > 0) parts.push(twoDigitsToWords(rest));

  return parts.join(' ');
}

/**
 * Rupees in words, using the South Asian numbering system — lakh and crore,
 * not million and billion. A challan printed for a Pakistani bank has to read
 * the way the teller expects.
 *
 * `500` -> `Five Hundred Only`
 * `125000` -> `One Lakh Twenty Five Thousand Only`
 */
export function rupeesToWords(paise: Paise): string {
  const rupees = Math.floor(Math.abs(paise) / PAISE_PER_RUPEE);
  const fraction = Math.abs(paise) % PAISE_PER_RUPEE;

  if (rupees === 0 && fraction === 0) return 'Zero Only';

  const parts: string[] = [];

  const crore = Math.floor(rupees / 10_000_000);
  const lakh = Math.floor((rupees % 10_000_000) / 100_000);
  const thousand = Math.floor((rupees % 100_000) / 1000);
  const remainder = rupees % 1000;

  if (crore > 0) parts.push(`${threeDigitsToWords(crore)} Crore`);
  if (lakh > 0) parts.push(`${threeDigitsToWords(lakh)} Lakh`);
  if (thousand > 0) parts.push(`${threeDigitsToWords(thousand)} Thousand`);
  if (remainder > 0) parts.push(threeDigitsToWords(remainder));

  if (fraction > 0) {
    parts.push(`and ${twoDigitsToWords(fraction)} Paisa`);
  }

  const words = parts.join(' ').replace(/\s+/g, ' ').trim();
  return `${paise < 0 ? 'Minus ' : ''}${words} Only`;
}
