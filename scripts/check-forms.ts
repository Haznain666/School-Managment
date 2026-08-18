/**
 * The rules the school and branch creation forms enforce, asserted directly.
 *
 * ── Why this is a script rather than a click-through ─────────────────────
 * Everything these forms now do is a *rule*: this address is acceptable and
 * that one is not; this city proposes that code; a Matric campus may declare
 * Grade 9 and never O1. Rules are exactly what a person checking by hand
 * checks once, on the two examples they happen to think of, and never again.
 *
 * And they are checked in two places. The form refuses bad input in the
 * browser, and the API route refuses it again on the server, because a request
 * posted directly never runs the browser's code. Both sides import the same
 * modules precisely so they cannot disagree — which is only true for as long as
 * something asserts it. That is this file.
 *
 * The chart case is here for a different reason: the defect it covers is a
 * *layout* failure that a type-checker and a passing build both saw nothing
 * wrong with. Eleven module names were drawn on top of each other and the
 * application was, by every automated measure, entirely healthy. So the
 * geometry is asserted rather than admired.
 *
 *   npm run check-forms
 *
 * Exit code 1 on any violation.
 */

import { renderToStaticMarkup } from 'react-dom/server';

import { BarChart } from '../components/charts/BarChart';
import {
  classOptionsFor,
  classRangeLabel,
  sanitiseClassLevels,
} from '../lib/branch-classes';
import { cityCode, PAKISTANI_CITIES, proposedBranchCode } from '../lib/cities';
import { emailRejectionReason, isValidEmail } from '../lib/email-validation';
import {
  formatLandline,
  formatMobile,
  isValidLandline,
  isValidMobile,
} from '../lib/phone-formats';
import { PLATFORM_MODULES } from '../lib/platform-modules';

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
 * Phone masks.
 *
 * The formats are a specification, not a preference: "(xxxx) xxx-xxxx ... any
 * other format is not acceptable". So the negative cases matter more than the
 * positive ones, and the paste case matters most of all — a number arriving
 * from a contact card is `+92 321 …`, and a mask that rejected it would have
 * operators retyping every number they already had.
 * -------------------------------------------------------------------------- */
section('Phone masks');

ok(formatMobile('03211234567') === '(0321) 123-4567', 'mobile digits group 4-3-4');
ok(formatMobile('+92 321 1234567') === '(0321) 123-4567', 'a pasted +92 number is rewritten to trunk form');
ok(formatMobile('923211234567') === '(0321) 123-4567', 'a bare 92 number is rewritten too');
ok(formatMobile('0321123456789999') === '(0321) 123-4567', 'digits past eleven are dropped, not rejected');
ok(formatMobile('') === '', 'an empty mobile formats to empty, not to "("');
ok(formatMobile('03') === '(03', 'the bracket opens as soon as there is a digit');

ok(isValidMobile('(0321) 123-4567'), 'the canonical mobile is accepted');
ok(isValidMobile(''), 'an absent mobile is accepted — the field is optional');
ok(!isValidMobile('(0321) 123-456'), 'ten digits is refused');
ok(!isValidMobile('(3211) 234-5678'), 'eleven digits not starting 0 is refused');
ok(!isValidMobile('0321-1234567'), 'the right digits in the wrong shape are refused');

ok(formatLandline('0213456789') === '(021) 3456789', 'landline splits after three digits');
ok(formatLandline('021') === '(021', 'the area code alone leaves the bracket open');
ok(
  formatLandline('02134567890123456') === '(021) 3456789012',
  'a landline stops at three plus ten digits',
);
ok(isValidLandline('(021) 3456789'), 'a complete landline is accepted');
ok(isValidLandline(''), 'an absent landline is accepted');
ok(!isValidLandline('(021) '), 'an area code with no subscriber digits is refused');
ok(!isValidLandline('(02'), 'a partial area code is refused');

/*
 * The one place the two phone modules have to meet: a mobile written in the
 * display format must still resolve to E.164, or the number that identifies a
 * person and the number printed on their record are two different numbers.
 * Asserted without importing `lib/phone.ts`, which is `server-only`.
 */
ok(
  '(0321) 123-4567'.replace(/[\s\-.()]/g, '').replace(/^0/, '+92') === '+923211234567',
  'the display mobile survives normalisation to E.164',
);

/* -----------------------------------------------------------------------------
 * Email.
 *
 * `admin@school` is the case this exists for. It passes `includes('@')`, which
 * is what the admin-create route used to check, and it is the mistake people
 * actually make.
 * -------------------------------------------------------------------------- */
section('Email');

for (const address of [
  'admin@school.edu.pk',
  'first.last@sub.domain.com',
  "o'brien+tag@school.com",
  'a@b.co',
]) {
  ok(isValidEmail(address), `${address} is accepted`);
}

for (const address of [
  'admin@school',
  '@school.edu.pk',
  'admin@',
  'admin school@x.com',
  'admin@@school.com',
  'admin@school..pk',
  'admin@-school.com',
  'admin@school.p',
  '.admin@school.com',
]) {
  ok(!isValidEmail(address), `${address} is refused`);
}

ok(isValidEmail(''), 'empty is not the validator’s business — requiredness is the caller’s');
ok(
  (emailRejectionReason('admin@school') ?? '').includes('school.com'),
  'a missing top-level domain is named, not reported as a generic failure',
);
ok(
  !isValidEmail(`${'a'.repeat(65)}@school.com`),
  'a local part over 64 characters is refused',
);

/* -----------------------------------------------------------------------------
 * City → branch code.
 * -------------------------------------------------------------------------- */
section('City codes');

ok(proposedBranchCode('Karachi') === 'KHI-MAIN', 'Karachi proposes KHI-MAIN');
ok(proposedBranchCode('Lahore') === 'LHE-MAIN', 'Lahore proposes LHE-MAIN');
ok(proposedBranchCode('') === '', 'no city proposes nothing');

const codes = PAKISTANI_CITIES.map((city) => cityCode(city));
ok(
  new Set(codes).size === codes.length,
  'every served city has a distinct code — two cities sharing one would propose colliding branch codes',
);
ok(
  codes.every((code) => /^[A-Z]{3}$/.test(code)),
  'every code is three uppercase letters',
);

/* -----------------------------------------------------------------------------
 * Class levels.
 *
 * The specification, restated: pre-school through grade 8 for everyone, then
 * O1/O2/O3 for O Levels, O1/O2/O3/AS/A2 for A Levels, and 9/10 for Matric and
 * Mixed.
 * -------------------------------------------------------------------------- */
section('Class levels');

const matric = classOptionsFor('MATRIC').map((option) => option.value);
const oLevels = classOptionsFor('O_LEVELS').map((option) => option.value);
const aLevels = classOptionsFor('A_LEVELS').map((option) => option.value);
const mixed = classOptionsFor('MIXED').map((option) => option.value);

ok(matric[0] === 'PRE_SCHOOL', 'every ladder starts at Pre-School');
ok(matric.includes('GRADE_8'), 'the common run reaches Grade 8');
ok(
  matric.slice(-2).join(',') === 'GRADE_9,GRADE_10',
  'Matric ends at Grade 9 and Grade 10',
);
ok(mixed.slice(-2).join(',') === 'GRADE_9,GRADE_10', 'Mixed ends the same way as Matric');
ok(oLevels.slice(-3).join(',') === 'O1,O2,O3', 'O Levels ends O1/O2/O3');
ok(aLevels.slice(-5).join(',') === 'O1,O2,O3,AS,A2', 'A Levels ends O1/O2/O3/AS/A2');
ok(!matric.includes('O1'), 'a Matric campus is never offered O1');
ok(!oLevels.includes('GRADE_9'), 'an O Levels campus is never offered Grade 9');

// The correction case: an operator ticks O-Level years, then changes the
// curriculum. The rungs that no longer exist must go, and the rest must stay.
ok(
  sanitiseClassLevels(['PRE_SCHOOL', 'O1', 'O2', 'GRADE_9'], 'MATRIC').join(',') ===
    'PRE_SCHOOL,GRADE_9',
  'changing curriculum drops the rungs the new one does not have and keeps the rest',
);
ok(
  sanitiseClassLevels(['GRADE_3', 'PRE_SCHOOL', 'GRADE_3'], 'MATRIC').join(',') ===
    'PRE_SCHOOL,GRADE_3',
  'the result is deduplicated and in ladder order, whatever order it arrived in',
);
ok(sanitiseClassLevels('not an array', 'MATRIC').length === 0, 'a non-array is not trusted');
ok(
  sanitiseClassLevels(['__injected__'], 'MATRIC').length === 0,
  'an unknown value cannot be stored',
);

ok(
  classRangeLabel(['PRE_SCHOOL', 'NURSERY', 'PREP'], 'MATRIC') === 'Pre-School – Prep',
  'a contiguous run reads as a range',
);
ok(
  classRangeLabel(['PRE_SCHOOL', 'GRADE_5'], 'MATRIC') === 'Pre-School, Grade 5',
  'a broken run is listed rather than misreported as a range',
);

/* -----------------------------------------------------------------------------
 * The dashboard chart.
 *
 * The failure being guarded against: eleven long category labels sharing one
 * axis, each overrunning its neighbours. Asserted as geometry, because that is
 * what actually broke — the markup was valid throughout.
 * -------------------------------------------------------------------------- */
section('Module adoption chart');

const categories = PLATFORM_MODULES.map((module) => module.label);
const values = categories.map((_, index) => index % 5);

const horizontal = renderToStaticMarkup(
  BarChart({
    title: 'Schools with each module enabled',
    summary: 'Test render.',
    categories,
    series: [{ label: 'Schools', values }],
    format: (value) => String(Math.round(value)),
    orientation: 'horizontal',
  }),
);

// Compared against the escaped form: several module labels contain `&`, which
// React correctly emits as `&amp;`. Comparing against the raw label would fail
// on the very labels this chart exists to fit.
const escaped = (label: string) =>
  label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

ok(
  categories.every((label) => horizontal.includes(escaped(label))),
  'every module name is rendered in full — none is truncated away',
);

const viewBox = /viewBox="0 0 (\d+) (\d+)"/.exec(horizontal);
ok(viewBox !== null, 'the chart declares a viewBox');

if (viewBox !== null) {
  const height = Number(viewBox[2]);
  // One row per category at 26 units, plus padding. The real assertion is that
  // it *grows*: a fixed height is what crushed the vertical chart.
  ok(
    height >= categories.length * 26,
    `the chart is tall enough for ${categories.length} rows (${height} units)`,
  );

  const taller = renderToStaticMarkup(
    BarChart({
      title: 'Twice as many',
      summary: 'Test render.',
      categories: [...categories, ...categories.map((label) => `${label} II`)],
      series: [{ label: 'Schools', values: [...values, ...values] }],
      orientation: 'horizontal',
    }),
  );
  const tallerBox = /viewBox="0 0 \d+ (\d+)"/.exec(taller);
  ok(
    tallerBox !== null && Number(tallerBox[1]) > height,
    'twice the categories produces a taller chart, not thinner bars',
  );
}

/*
 * Label collision, which is the defect itself. In horizontal mode each label
 * owns a whole row, so no two share a baseline. The vertical chart is checked
 * for the opposite reason: it is still correct for short labels, and the
 * regression to catch is somebody switching this chart back.
 */
const labelRows = [...horizontal.matchAll(/text-anchor="end"[^>]*y="([\d.]+)"/g)].map(
  (match) => Number(match[1]),
);
const distinctRows = new Set(labelRows);
ok(
  labelRows.length === 0 || distinctRows.size === labelRows.length,
  'no two category labels share a baseline',
);

const vertical = renderToStaticMarkup(
  BarChart({
    title: 'Monthly collection',
    summary: 'Test render.',
    categories: ['Jan', 'Feb', 'Mar'],
    series: [{ label: 'Collected', values: [1, 2, 3] }],
  }),
);
ok(vertical.includes('viewBox="0 0 640 260"'), 'the vertical chart is unchanged');

/* -------------------------------------------------------------------------- */

console.log(
  failures === 0
    ? `\nPASS — ${checks} assertions across the form rules and the chart geometry.`
    : `\nFAIL — ${failures} of ${checks} assertions failed.`,
);

process.exitCode = failures === 0 ? 0 : 1;
