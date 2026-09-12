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
import { LineChart } from '../components/charts/LineChart';
import {
  classLabel,
  classOptionsFor,
  classRangeLabel,
  sanitiseClassLevels,
} from '../lib/branch-classes';
import { cityCode, PAKISTANI_CITIES, proposedBranchCode } from '../lib/cities';
import { emailRejectionReason, isValidEmail } from '../lib/email-validation';
import { getGradesForCurriculum } from '../lib/predefined-grades';
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

/* -----------------------------------------------------------------------------
 * The ladder and the branch form describe the same curriculum.
 *
 * These are two modules answering two different questions — `branch-classes`
 * asks a campus which classes it runs, `predefined-grades` seeds the rungs a
 * child can be enrolled into — and for as long as nothing asserted it, they
 * were free to disagree. They did. The branch form offered `O1, O2, O3` after
 * Grade 8 and the ladder seeded `Year 9, O Level 1, O Level 2`, which is the
 * Matric shape wearing Cambridge names: it invented a year no Cambridge school
 * teaches, and ran the O-Level course for two years instead of three.
 *
 * What that costs is not cosmetic. An operator declares a campus running
 * `O1-O3` on the branch form, and the grade ladder then hands that campus a
 * `Year 9` nobody asked for and no `O3` to put the leaving year into. The
 * declaration and the enrolment target are the same fact told twice, so the
 * assertion is that the tails match, name for name.
 * -------------------------------------------------------------------------- */

const oLadder = getGradesForCurriculum('O_LEVELS').map((grade) => grade.name);
const aLadder = getGradesForCurriculum('A_LEVELS').map((grade) => grade.name);
const matricLadder = getGradesForCurriculum('MATRIC').map((grade) => grade.name);

ok(
  oLadder.slice(-3).join(',') === 'O1,O2,O3',
  'the O Levels ladder ends O1/O2/O3, the same three the branch form offers',
);
ok(
  !oLadder.includes('Year 9'),
  'there is no Year 9 on the O Levels ladder — Year 8 is followed by O1',
);
ok(
  aLadder.slice(-5).join(',') === 'O1,O2,O3,AS Level,A2 Level',
  'the A Levels ladder continues the O Levels one through sixth form',
);
ok(
  matricLadder.slice(-2).join(',') === 'Class 9,Class 10',
  'the Matric ladder still ends at Class 9 and Class 10',
);

// Tail for tail, the two modules name the same rungs. `classLabel` is what an
// operator reads on the branch form; the ladder name is what the grade is
// called on every screen after it.
ok(
  oLevels.slice(-3).map(classLabel).join(',') === oLadder.slice(-3).join(','),
  'branch form and grade ladder name the O Levels senior years identically',
);
ok(
  aLevels.slice(-5).map(classLabel).join(',') ===
    aLadder.slice(-5).map((name) => name.replace(' Level', '')).join(','),
  'branch form and grade ladder name the A Levels senior years identically',
);

// Every ladder is contiguous from 1 and has no repeated rung, which is what
// makes `(branch_id, sort_order)` a stable key and promotion a walk of one.
for (const [curriculum, ladder] of [
  ['MATRIC', getGradesForCurriculum('MATRIC')],
  ['O_LEVELS', getGradesForCurriculum('O_LEVELS')],
  ['A_LEVELS', getGradesForCurriculum('A_LEVELS')],
  ['MIXED', getGradesForCurriculum('MIXED')],
] as const) {
  ok(
    ladder.every((grade, index) => grade.sortOrder === index + 1),
    `${curriculum}: sort orders are 1-based and contiguous`,
  );
  ok(
    new Set(ladder.map((grade) => grade.name)).size === ladder.length,
    `${curriculum}: no rung name appears twice`,
  );
}

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
/*
 * Every chart now draws twice — a desktop drawing and a phone one — so the
 * markup holds two `<svg>`s whose rows share y coordinates by design. Each
 * assertion below is made per drawing, never across the whole markup.
 */
function drawings(markup: string): { desktop: string; phone: string } {
  const svgs = markup.match(/<svg[\s\S]*?<\/svg>/g) ?? [];
  return { desktop: svgs[0] ?? '', phone: svgs[1] ?? '' };
}

function viewBoxOf(svg: string): { width: number; height: number } | null {
  const match = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  return match === null ? null : { width: Number(match[1]), height: Number(match[2]) };
}

/*
 * Label collision, measured. Every anchored label is placed as an interval on
 * its baseline at the glyph widths the charts themselves reserve (6.4 units per
 * 11px category glyph, 5.2 per 10px tick), and no two on one baseline may touch.
 *
 * That is circular in the widths — it cannot prove a real font agrees with 6.4
 * — and is not trying to. (The font was checked once, in Chromium: short
 * capitalised labels run 6.3–7.2 units a glyph, which is why it is not 5.6.) What it catches is the *logic*: a stride that does
 * not thin enough, an end-anchored last label drawn over its neighbour, a
 * phone drawing laid out with the desktop's budget. Those are the shapes this
 * defect has taken every time it has shipped.
 */
function overlappingLabels(svg: string): string[] {
  const pattern =
    /<text x="([-\d.]+)" y="([-\d.]+)" text-anchor="(start|middle|end)"(?: dominant-baseline="[^"]*")? class="([^"]*)">([^<]*)<\/text>/g;
  const byBaseline = new Map<string, Array<[number, number, string]>>();

  for (const match of svg.matchAll(pattern)) {
    const [, rawX, y, anchor, classes, rawText] = match;
    const text = rawText!.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    const glyph = classes!.includes('text-[10px]') ? 5.2 : 6.4;
    const width = text.length * glyph;
    const x = Number(rawX);
    const extent: [number, number, string] =
      anchor === 'start'
        ? [x, x + width, text]
        : anchor === 'end'
          ? [x - width, x, text]
          : [x - width / 2, x + width / 2, text];
    const row = byBaseline.get(y!) ?? [];
    row.push(extent);
    byBaseline.set(y!, row);
  }

  const collisions: string[] = [];
  for (const row of byBaseline.values()) {
    row.sort((left, right) => left[0] - right[0]);
    for (let index = 1; index < row.length; index += 1) {
      if (row[index]![0] < row[index - 1]![1]) {
        collisions.push(`"${row[index - 1]![2]}" / "${row[index]![2]}"`);
      }
    }
  }
  return collisions;
}

function noCollisions(markup: string, what: string): void {
  const { desktop, phone } = drawings(markup);
  const onDesktop = overlappingLabels(desktop);
  const onPhone = overlappingLabels(phone);
  ok(onDesktop.length === 0, `${what}: no labels collide on the desktop drawing ${onDesktop.join(', ')}`);
  ok(onPhone.length === 0, `${what}: no labels collide on the phone drawing ${onPhone.join(', ')}`);
}

noCollisions(horizontal, 'module adoption');

const vertical = renderToStaticMarkup(
  BarChart({
    title: 'Monthly collection',
    summary: 'Test render.',
    categories: ['Jan', 'Feb', 'Mar'],
    series: [{ label: 'Collected', values: [1, 2, 3] }],
  }),
);
ok(vertical.includes('viewBox="0 0 640 260"'), 'the vertical chart is unchanged');

/* -----------------------------------------------------------------------------
 * The phone drawing.
 *
 * A 640-unit viewBox in a ~300px phone card draws an 11-unit label at ~5px:
 * nothing overlaps and nothing can be read. So every bar and line chart draws
 * a second, 320-unit drawing that only a phone shows. The defect to catch is
 * the second drawing going missing, being shown on a desktop, or being laid
 * out with the desktop's label budget.
 * -------------------------------------------------------------------------- */
section('Charts on a phone');

{
  const { desktop, phone } = drawings(vertical);
  ok(phone !== '', 'a vertical bar chart draws a phone drawing');
  ok(/class="[^"]*\bhidden sm:block\b/.test(desktop), 'the desktop drawing is hidden below sm');
  ok(/class="[^"]*\bsm:hidden\b/.test(phone), 'the phone drawing is hidden from sm up');
  const box = viewBoxOf(phone);
  ok(box?.width === 320 && box.height === 220, 'the phone drawing is 320 × 220 units');
  ok((vertical.match(/<table/g) ?? []).length === 1, 'the accessible table is emitted once, not per drawing');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthly = renderToStaticMarkup(
  BarChart({
    title: 'Collection by month',
    summary: 'Test render.',
    categories: MONTHS,
    series: [{ label: 'Collected', values: MONTHS.map((_, index) => 100_000 * (index + 1)) }],
  }),
);
ok(
  viewBoxOf(drawings(monthly).desktop)?.height === 260,
  'twelve months stand up on a desktop, as they always have',
);
ok(
  (viewBoxOf(drawings(monthly).phone)?.height ?? 0) >= MONTHS.length * 26,
  'twelve months lie on their side on a phone — at 320 units they drew 1px apart',
);

/*
 * Two series in a horizontal row. A 10px value label is ~12.8 units tall, and
 * a fixed 26-unit row gave each series 10.4 — so the two figures on every row
 * printed into each other. Asserted from the viewBox: the bars take four fifths
 * of a row, and each series needs 13 of it.
 */
{
  const twoSeries = renderToStaticMarkup(
    BarChart({
      title: 'Pass rate and average by exam',
      summary: 'Test render.',
      categories: ['Mid-term · Grade 5 A', 'Mid-term · Grade 6 A', 'Finals · Grade 7 B'],
      series: [
        { label: 'Pass rate', values: [92, 78, 85] },
        { label: 'Average', values: [71, 64, 69] },
      ],
      format: (value) => `${Math.round(value)}%`,
      orientation: 'horizontal',
    }),
  );
  for (const [name, svg] of Object.entries(drawings(twoSeries))) {
    const box = viewBoxOf(svg);
    // 8 top + 26 bottom padding, the rest is rows.
    const perSeries = box === null ? 0 : ((box.height - 34) / 3) * 0.8 / 2;
    ok(perSeries >= 13, `two series give each value label ≥ 13 units per row on the ${name} drawing (${perSeries.toFixed(1)})`);
  }
}
noCollisions(monthly, 'twelve months');

// The fees dashboard's ageing chart: fits a desktop standing up, not a phone.
const buckets = ['Current', '1–30 days', '31–60 days', '61–90 days', 'Over 90 days'];
const ageing = renderToStaticMarkup(
  BarChart({
    title: 'Ageing of receivables',
    summary: 'Test render.',
    categories: buckets,
    series: [{ label: 'Outstanding', values: [1_250_000, 480_000, 220_000, 95_000, 40_000] }],
    format: (value) => `PKR ${Math.round(value).toLocaleString('en-US')}`,
  }),
);
{
  const { desktop, phone } = drawings(ageing);
  ok(viewBoxOf(desktop)?.height === 260, 'the ageing chart stands up on a desktop, as before');
  const box = viewBoxOf(phone);
  ok(
    box !== null && box.width === 320 && box.height >= buckets.length * 26,
    'the ageing chart lies on its side on a phone, where "Over 90 days" cannot fit a bar',
  );
}
noCollisions(ageing, 'ageing buckets with money ticks');

// Askari's classes, which is where this was found.
const askari = ['Pre-Nursery A', 'Nursery A', 'Nursery B', 'Prep A', 'Prep B'].concat(
  ['Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Year 6', 'Year 7', 'Year 8', 'O1', 'O2', 'O3'].flatMap(
    (grade) => [`${grade} A`, `${grade} B`],
  ),
);
const classes = renderToStaticMarkup(
  BarChart({
    title: 'Attendance by class',
    summary: 'Test render.',
    categories: askari,
    series: [{ label: 'Attendance', values: askari.map((_, index) => 60 + (index % 40)) }],
    format: (value) => `${Math.round(value)}%`,
  }),
);
{
  const { desktop, phone } = drawings(classes);
  ok(
    viewBoxOf(desktop)!.height >= askari.length * 26 && viewBoxOf(phone)!.height >= askari.length * 26,
    `${askari.length} class names left at vertical are drawn horizontally in both drawings`,
  );
  ok(
    askari.every((label) => phone.includes(`>${label}<`)),
    'every Askari class name fits the phone label column untruncated',
  );
}
noCollisions(classes, `${askari.length} classes`);

const trend = renderToStaticMarkup(
  LineChart({
    title: 'Attendance rate by month',
    summary: 'Test render.',
    categories: MONTHS.map((month) => `${month} 2026`),
    series: [{ label: 'Attendance', values: MONTHS.map((_, index) => 80 + (index % 7)) }],
    format: (value) => `${Math.round(value)}%`,
  }),
);
{
  const { desktop, phone } = drawings(trend);
  ok(viewBoxOf(desktop)?.width === 640 && viewBoxOf(phone)?.width === 320, 'a line chart draws both drawings');
  ok(phone.includes('>Dec 2026<') && desktop.includes('>Dec 2026<'), 'the final period is always labelled');
}
noCollisions(trend, 'a twelve-month line chart');

/* -------------------------------------------------------------------------- */

console.log(
  failures === 0
    ? `\nPASS — ${checks} assertions across the form rules and the chart geometry.`
    : `\nFAIL — ${failures} of ${checks} assertions failed.`,
);

process.exitCode = failures === 0 ? 0 : 1;
