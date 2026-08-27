/**
 * Money is rendered by `lib/money.ts`, everywhere, including on screens nobody
 * has written yet.
 *
 * ── The rule ─────────────────────────────────────────────────────────────
 * **A rupee amount reaches a person through `formatPkr` or `formatAmount`.**
 * `formatPkr` carries the `PKR ` prefix and `formatAmount` does not; between
 * them they own the thousands separators, the two-decimal ceiling and the
 * `en-PK` grouping. Nothing else may write the prefix, round the figure or
 * divide paise by hand on its way to a screen.
 *
 * ── Why it is worth a script ─────────────────────────────────────────────
 * The functions already existed and were already right. The defect was
 * entirely in the call sites: `PKR ${row.totalAmount}` printed `PKR 125000.00`
 * where the same figure two columns over read `PKR 1,25,000` — on one screen,
 * to one person, about one voucher. A parent reading a slip that says
 * `PKR 125000.00` has to count the digits, which is exactly what a separator
 * exists to prevent, and a school reading two spellings of one number in one
 * table stops trusting the table.
 *
 * Sprint 18 swept them. This is what stops the next one arriving: the obvious
 * thing to type is `PKR {amount}`, it looks right in review, and nothing about
 * a green build would say otherwise.
 *
 * ── What is deliberately NOT flagged ─────────────────────────────────────
 * `toFixed(2)` on its way *into* the database or onto the wire. A NUMERIC(12,2)
 * column wants `'1250.00'` and a JSON payload carrying a balance wants the same
 * — that is serialisation, not display, and `paiseToNumeric` is its own answer
 * to it. The three rules below fire only on the shapes that put a number in
 * front of a human.
 *
 *   npm run check-currency
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { formatAmount, formatPkr } from '../lib/money';

let failures = 0;
let checks = 0;

function ok(condition: boolean, description: string): void {
  checks += 1;
  if (condition) return;
  failures += 1;
  console.log(`  ✗ ${description}`);
}

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

/* -----------------------------------------------------------------------------
 * 1. The formatters themselves.
 *
 * Asserted directly, because every call site the scan below forces through them
 * is only as correct as they are.
 * -------------------------------------------------------------------------- */
section('The formatters');

ok(formatPkr('125000') === 'PKR 125,000', 'formatPkr carries the prefix and the separators');
ok(formatAmount('125000') === '125,000', 'formatAmount is the same figure without the prefix');
ok(formatAmount('1250.5') === '1,250.5', 'a half rupee survives');
ok(formatAmount('1250.00') === '1,250', 'a trailing .00 is dropped rather than printed');
ok(formatAmount(null) === '0', 'an absent amount reads as zero, never as NaN');

/* -----------------------------------------------------------------------------
 * 2. The scan.
 * -------------------------------------------------------------------------- */

const ROOTS = ['app', 'components', 'lib'];

/** The module that owns the formatting, and the script that asserts it. */
const EXEMPT = new Set([
  join('lib', 'money.ts'),
  join('scripts', 'check-currency.ts'),
]);

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/** A comment line. Prose is allowed to say `PKR ${…}` while explaining why not to. */
function isProse(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

interface Offence {
  file: string;
  line: number;
  rule: string;
  text: string;
}

const offences: Offence[] = [];

/**
 * Rule 1 — a hard-coded `PKR ` in front of an interpolated value.
 *
 * `PKR ${row.totalAmount}` and `PKR {group.total}`. The literal prefix is what
 * gives it away: a call site that has already been through `formatPkr` does not
 * need to write the currency itself.
 */
const HARD_CODED_PREFIX = /PKR\s*[{$]\{?/;

/**
 * Rule 2 — rounding a money value by hand for display.
 *
 * `Number(amount).toFixed(2)`. Serialisation is spelled `paiseToNumeric` or is
 * a bare `.toFixed(2)` on a value that never reaches a screen; wrapping in
 * `Number(…)` first is the shape that only ever appears on the way out.
 */
const HAND_ROUNDING = /Number\([^)]*\)\.toFixed\(2\)/;

/**
 * Rule 3 — dividing paise by hand inside something being rendered.
 *
 * `{paisePaid / 100}`. Flagged only when the interpolation does not also call a
 * formatter, because `formatAmount(remainingPaise / 100)` is the correct shape
 * and is common: paise are the unit the arithmetic happens in, and the division
 * belongs immediately inside the call that renders the result.
 */
const RAW_PAISE = /[{$]\{[^{}]*\/\s*100(?![\d_])[^{}]*\}/;

for (const root of ROOTS) {
  for (const file of walk(root, [])) {
    const relativePath = relative('.', file);
    if (EXEMPT.has(relativePath)) continue;

    const lines = readFileSync(file, 'utf8').split(/\r?\n/);

    for (const [index, line] of lines.entries()) {
      if (isProse(line)) continue;

      const at = { file: relativePath, line: index + 1, text: line.trim() };

      if (HARD_CODED_PREFIX.test(line)) {
        offences.push({ ...at, rule: 'a hard-coded PKR prefix — use formatPkr()' });
      }
      if (HAND_ROUNDING.test(line)) {
        offences.push({ ...at, rule: 'Number(…).toFixed(2) — use formatAmount()' });
      }
      if (RAW_PAISE.test(line) && !/format(Pkr|Amount)\(/.test(line)) {
        offences.push({
          ...at,
          rule: 'paise divided by hand in a rendered value — pass it to formatAmount()',
        });
      }
    }
  }
}

section('Every rupee amount goes through lib/money.ts');

for (const offence of offences) {
  console.log(
    `  ✗ ${offence.file}:${String(offence.line)} — ${offence.rule}\n      ${offence.text}`,
  );
}

console.log(
  `  scanned ${String(ROOTS.length)} roots, ${String(offences.length)} violations`,
);

ok(offences.length === 0, 'no rupee amount is formatted outside lib/money.ts');

/*
 * The positive direction, for the same reason `check-cnic` has one: a clean
 * scan would otherwise be satisfied by a product that renders no money at all.
 */
let usages = 0;
for (const root of ROOTS) {
  for (const file of walk(root, [])) {
    if (EXEMPT.has(relative('.', file))) continue;
    if (/format(Pkr|Amount)\(/.test(readFileSync(file, 'utf8'))) usages += 1;
  }
}

ok(usages >= 10, `the formatters are actually in use (${String(usages)} modules)`);

/* -------------------------------------------------------------------------- */

console.log(
  failures === 0
    ? `\nPASS — ${String(checks)} assertions across the money formatters and their call sites.`
    : `\nFAIL — ${String(failures)} of ${String(checks)} assertions failed.`,
);

process.exitCode = failures === 0 ? 0 : 1;
