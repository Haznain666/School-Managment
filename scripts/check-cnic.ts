/**
 * The CNIC protocol, asserted — including for screens not yet written.
 *
 * ── The rule ─────────────────────────────────────────────────────────────
 * **Every CNIC input in this product is `CnicField`.** Not "should be": *is*.
 * The requirement was explicit that it applies "on all the screens wherever
 * CNIC is being requested" and to "all the future developments as well". A
 * rollout answers the first half; only this script answers the second, because
 * the next person to add a staff form will reach for `<Input label="CNIC" />`
 * — that is what every other field on their form looks like — and nothing about
 * a green build would tell them otherwise.
 *
 * The one exemption is `NationalIdField`, which asks for a CNIC *or* a B-Form
 * and therefore has to choose its own label and its own validation. It is
 * exempt only while it goes on calling `formatCnic(` and `isValidCnic(`, so
 * the exemption is for a field that already enforces the mask, not for a
 * filename.
 *
 * ── Why this is worth a check and not a code review ──────────────────────
 * The mask is not cosmetic. `student_guardians.cnic` is the key that decides
 * which enrolled children are siblings (`lib/siblings.ts`), and a column
 * holding `4210112345671` on one row and `42101-1234567-1` on another reads as
 * two different people. The two spellings are indistinguishable on screen,
 * because both render as a masked field. So an unmasked input does not produce
 * an ugly value — it produces a family that silently stops being a family.
 *
 * ── Two halves ───────────────────────────────────────────────────────────
 * 1. **Behaviour.** `formatCnic`, `isValidCnic` and above all `normalizeCnic`
 *    are asserted directly. `normalizeCnic` is the piece whose failure would
 *    be silent: it decides identity, and getting it wrong either splits a
 *    family or invents one.
 *
 * 2. **Reach.** Every `.tsx` under `app/` and `components/` is scanned for a
 *    raw `<Input>` or `<SecretInput>` whose literal label names a CNIC. A
 *    static scan of source text rather than of a parsed tree, which is crude
 *    and is the right amount of machinery: the thing being prevented is
 *    somebody typing the obvious wrong thing, and the obvious wrong thing is
 *    spelled exactly one way.
 *
 *   npm run check-cnic
 *
 * Exit code 1 on any violation.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import {
  CNIC_PATTERN,
  cnicProblem,
  formatCnic,
  isValidCnic,
  maskNationalId,
  normalizeCnic,
} from '../lib/national-id';

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
 * 1. The mask, as it behaves under typing.
 * -------------------------------------------------------------------------- */
section('The 5-7-1 mask');

ok(formatCnic('4210112345671') === '42101-1234567-1', 'bare digits are grouped');
ok(formatCnic('42101 1234567 1') === '42101-1234567-1', 'a pasted spaced number is regrouped');
ok(formatCnic('42101-1234567-1') === '42101-1234567-1', 'an already-masked number is unchanged');
ok(formatCnic('abc42101xyz') === '42101', 'letters are discarded, not refused');
ok(formatCnic('42101123456712345') === '42101-1234567-1', 'input past thirteen digits is dropped');
ok(formatCnic('') === '', 'an empty field masks to empty, never to a lone hyphen');
ok(formatCnic('4210') === '4210', 'a half-typed number keeps no trailing hyphen');
ok(formatCnic('42101') === '42101', 'the hyphen arrives with the sixth digit, not the fifth');
ok(formatCnic('421011') === '42101-1', 'the sixth digit brings the first hyphen');

/* -----------------------------------------------------------------------------
 * 2. Validation.
 * -------------------------------------------------------------------------- */
section('Validation');

ok(isValidCnic('42101-1234567-1'), 'the canonical form passes');
ok(!isValidCnic('4210112345671'), 'thirteen correct digits in the wrong shape are refused — the format is the spec');
ok(!isValidCnic('42101-123456-1'), 'twelve digits is not a CNIC');
ok(!isValidCnic('42101-1234567-12'), 'fourteen digits is not a CNIC');
ok(cnicProblem('') === null, 'blank is acceptable everywhere — a school must be able to enroll a child whose parent left the card at home');
ok(cnicProblem('42101-1234567-1') === null, 'a whole number earns no message');
ok(cnicProblem('42101-12') !== null, 'a half-typed number does earn one');
ok(CNIC_PATTERN.test('42101-1234567-1'), 'the exported pattern matches the canonical form');

/* -----------------------------------------------------------------------------
 * 3. normalizeCnic — the piece that decides who is a sibling.
 *
 * Every case here is a value that already exists in the column, written by one
 * of the four unmasked inputs this rule replaces. If any of them canonicalises
 * wrongly, two children either stop being siblings or start being siblings,
 * and nothing on any screen would say so.
 * -------------------------------------------------------------------------- */
section('Canonicalisation');

for (const stored of [
  '4210112345671',
  '42101-1234567-1',
  '42101 1234567 1',
  '42101.1234567.1',
  ' 42101-1234567-1 ',
]) {
  ok(
    normalizeCnic(stored) === '42101-1234567-1',
    `"${stored}" canonicalises to one spelling`,
  );
}

ok(normalizeCnic(null) === null, 'null stays null — most guardians have no CNIC recorded');
ok(normalizeCnic(undefined) === null, 'undefined stays null');
ok(normalizeCnic('') === null, 'empty is not a CNIC — as an identity key it would match every other blank');
ok(normalizeCnic('   ') === null, 'whitespace is not a CNIC either');
ok(
  normalizeCnic('42101-123456-1') === null,
  'twelve digits canonicalise to null rather than being padded — a half-recorded identity number must never match another half',
);
ok(
  normalizeCnic('B-Form 12345') === null,
  'a B-Form number typed into a CNIC box is refused, not truncated into a plausible CNIC',
);
ok(
  normalizeCnic('42101123456712345') === null,
  'seventeen digits are refused, not trimmed to the first thirteen — trimming would invent a match',
);

// The property that matters: canonicalising twice changes nothing. Anything
// else means the column drifts every time a row is re-saved.
ok(
  normalizeCnic(normalizeCnic('4210112345671')) === '42101-1234567-1',
  'canonicalisation is idempotent',
);

// And the one that the migration depends on: the SQL back-fill in 0026 does
// exactly this, so the two must agree on every value it will meet.
ok(
  normalizeCnic('4210112345671') === formatCnic('4210112345671'),
  'the storage form and the typing form agree on a whole number',
);

/* -----------------------------------------------------------------------------
 * 4. Masking — what is painted before the eye is clicked.
 * -------------------------------------------------------------------------- */
section('Masking');

ok(
  maskNationalId('42101-1234567-1') === '•••••-•••••67-1',
  'everything but the last four characters is dotted, and the hyphens survive',
);
ok(
  maskNationalId('42101-1234567-1').length === '42101-1234567-1'.length,
  'the masked form is the same width, so the field does not jump when revealed',
);

/* -----------------------------------------------------------------------------
 * 5. Reach — no raw field anywhere asks for a CNIC.
 * -------------------------------------------------------------------------- */
section('Every CNIC field uses the shared component');

const ROOTS = ['app', 'components'];

/** The component a raw input must not be used in place of. */
const CNIC_COMPONENT = 'CnicField';

/** Names that make a field a CNIC field. */
const CNIC_LABEL = /\bcnic\b|smart\s*card|\bnic\b/i;

/**
 * The components that necessarily render a raw input themselves.
 *
 * `CnicField` is the shared component. `NationalIdField` is the student's own
 * document pair, which asks for a CNIC *or* a B-Form and so cannot use a field
 * hard-coded to one of them — exempt only while it still applies the mask
 * itself, which is asserted below rather than assumed.
 */
const SELF = new Set([
  join('components', 'ui', 'CnicField.tsx'),
  join('components', 'admissions', 'NationalIdField.tsx'),
]);

const NATIONAL_ID_FIELD = join('components', 'admissions', 'NationalIdField.tsx');

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/**
 * The props of one JSX element, as source text.
 *
 * Braces are counted from the opening tag to the matching `>` rather than
 * matched with one regex, because a prop value like `onChange={() => { … }}`
 * contains a `>` and a lazy regex stops there — truncating the props of exactly
 * the fields most likely to be wrong. Lifted deliberately from
 * `check-address-phone.ts`, which solved the same problem for phones.
 */
function elementProps(source: string, start: number): string {
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (character === '{') depth += 1;
    else if (character === '}') depth -= 1;
    else if (character === '>' && depth === 0) return source.slice(start, index);
  }
  return source.slice(start, start + 600);
}

const violations: { file: string; label: string }[] = [];
let scanned = 0;
let fieldsSeen = 0;

for (const root of ROOTS) {
  for (const file of walk(root, [])) {
    const relativePath = relative('.', file);
    if (SELF.has(relativePath)) continue;

    const source = readFileSync(file, 'utf8');
    scanned += 1;

    for (const match of source.matchAll(/<(Input|SecretInput|Textarea)\b/g)) {
      const props = elementProps(source, match.index + match[0].length);
      const label = /\blabel=(?:"([^"]*)"|'([^']*)')/.exec(props);
      if (label === null) continue;

      const text = label[1] ?? label[2] ?? '';
      fieldsSeen += 1;

      if (CNIC_LABEL.test(text)) {
        violations.push({ file: relativePath, label: text });
      }
    }
  }
}

for (const violation of violations) {
  console.log(
    `  ✗ ${violation.file}: <Input label="${violation.label}"> must be <${CNIC_COMPONENT}>`,
  );
}

checks += 1;
if (violations.length > 0) failures += 1;

console.log(
  `  scanned ${String(scanned)} components, ${String(fieldsSeen)} labelled fields, ` +
    `${String(violations.length)} violations`,
);

// The narrow exemption, verified rather than trusted.
const nationalIdSource = readFileSync(NATIONAL_ID_FIELD, 'utf8');
ok(
  nationalIdSource.includes('formatCnic(') && nationalIdSource.includes('isValidCnic('),
  'NationalIdField is exempt only while it applies the mask and the validation itself',
);

// And the positive direction: the shared field must actually be in use, or a
// green scan would only prove that nobody asks for a CNIC at all.
let usages = 0;
for (const root of ROOTS) {
  for (const file of walk(root, [])) {
    if (SELF.has(relative('.', file))) continue;
    if (readFileSync(file, 'utf8').includes('<CnicField')) usages += 1;
  }
}

ok(
  usages >= 3,
  `CnicField is used on at least three screens (found ${String(usages)}) — guardians on enrollment, guardians on a profile, and staff`,
);

/* -------------------------------------------------------------------------- */

console.log(
  failures === 0
    ? `\nPASS — ${String(checks)} assertions across the CNIC mask, canonicalisation and the field rollout.`
    : `\nFAIL — ${String(failures)} of ${String(checks)} assertions failed.`,
);

process.exitCode = failures === 0 ? 0 : 1;
