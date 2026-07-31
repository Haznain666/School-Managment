/**
 * Rupee arithmetic (Sprint 5 quality gate).
 *
 * Money is NUMERIC in the database and reaches JavaScript as a *string*, which
 * is deliberate: `0.1 + 0.2` is not `0.3` in a double, and a fee module that
 * loses a paisa per line loses a real school real money. Every calculation in
 * this application therefore converts to integer paise, does whole-number
 * arithmetic, and converts back only when the result is written or printed.
 *
 * The rule for callers: never add, multiply or compare two rupee *strings*.
 * Convert with `toPaise`, work in paise, and finish with `paiseToNumeric`.
 */

/** A rupee value as it arrives from the database or a form. */
export type MoneyInput = string | number | null | undefined;

/**
 * Converts a rupee amount to whole paise.
 *
 * Anything unparseable becomes 0 rather than NaN: these values come from the
 * database and from form fields, and a NaN would silently poison every sum it
 * touched instead of failing where it went wrong.
 */
export function toPaise(value: MoneyInput): number {
  if (value === null || value === undefined) return 0;

  const numeric = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(numeric)) return 0;

  return Math.round(numeric * 100);
}

/** Whole paise back to rupees as a number, for display and JSON. */
export function fromPaise(paise: number): number {
  return Math.round(paise) / 100;
}

/** Whole paise to the string a NUMERIC(12,2) column expects. */
export function paiseToNumeric(paise: number): string {
  return (Math.round(paise) / 100).toFixed(2);
}

/**
 * Applies a percentage to a paise amount, rounded to the nearest paisa.
 *
 * Rounding happens once, here, rather than at each caller — so a 33% concession
 * on 1,000.00 is 330.00 everywhere it is computed.
 */
export function percentOfPaise(paise: number, percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.round((paise * percent) / 100);
}

/** Clamps a paise amount into a range. Used to stop a discount exceeding a fee. */
export function clampPaise(paise: number, min: number, max: number): number {
  return Math.min(Math.max(paise, min), max);
}

const PKR_FORMATTER = new Intl.NumberFormat('en-PK', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** `12500` -> `PKR 12,500`. For screen and print. */
export function formatPkr(value: MoneyInput): string {
  return `PKR ${PKR_FORMATTER.format(fromPaise(toPaise(value)))}`;
}

/** `12500` -> `12,500`, without the currency prefix. */
export function formatAmount(value: MoneyInput): string {
  return PKR_FORMATTER.format(fromPaise(toPaise(value)));
}

const ONES: readonly string[] = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];

const TENS: readonly string[] = [
  '',
  '',
  'Twenty',
  'Thirty',
  'Forty',
  'Fifty',
  'Sixty',
  'Seventy',
  'Eighty',
  'Ninety',
];

/** 0–999 in words. Empty string for 0, so callers can skip empty groups. */
function underThousandInWords(value: number): string {
  if (value === 0) return '';

  if (value < 20) return ONES[value] ?? '';

  if (value < 100) {
    const tens = TENS[Math.floor(value / 10)] ?? '';
    const ones = ONES[value % 10] ?? '';
    return ones === '' ? tens : `${tens} ${ones}`;
  }

  const hundreds = `${ONES[Math.floor(value / 100)] ?? ''} Hundred`;
  const remainder = underThousandInWords(value % 100);
  return remainder === '' ? hundreds : `${hundreds} ${remainder}`;
}

/**
 * A rupee amount in words, on the South Asian scale.
 *
 * Printed on every challan because that is what a bank slip requires: the
 * figure in words is what stops a `1,000` being altered to a `10,000` between
 * the school gate and the cashier's window. Lakh and crore rather than million
 * and billion — this is a Pakistani slip, read by a Pakistani teller.
 *
 * @example amountInWords(125_500) === 'One Lakh Twenty Five Thousand Five Hundred Rupees Only'
 */
export function amountInWords(value: MoneyInput): string {
  const paise = toPaise(value);
  const negative = paise < 0;
  const absolute = Math.abs(paise);

  const rupees = Math.floor(absolute / 100);
  const remainderPaise = absolute % 100;

  const parts: string[] = [];

  const crore = Math.floor(rupees / 10_000_000);
  const lakh = Math.floor((rupees % 10_000_000) / 100_000);
  const thousand = Math.floor((rupees % 100_000) / 1_000);
  const rest = rupees % 1_000;

  if (crore > 0) parts.push(`${underThousandInWords(crore)} Crore`);
  if (lakh > 0) parts.push(`${underThousandInWords(lakh)} Lakh`);
  if (thousand > 0) parts.push(`${underThousandInWords(thousand)} Thousand`);
  if (rest > 0) parts.push(underThousandInWords(rest));

  if (parts.length === 0 && remainderPaise === 0) return 'Zero Rupees Only';

  const rupeeWords = parts.length === 0 ? '' : `${parts.join(' ')} Rupees`;

  const paisaWords =
    remainderPaise === 0
      ? ''
      : `${underThousandInWords(remainderPaise)} Paisa`;

  const joined = [rupeeWords, paisaWords].filter((part) => part !== '').join(' and ');

  return `${negative ? 'Minus ' : ''}${joined} Only`;
}
