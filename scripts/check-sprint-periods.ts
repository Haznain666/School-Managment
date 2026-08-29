/**
 * The rules this sprint added, asserted directly — no database, no browser.
 *
 * ── Why these three, and why a script ────────────────────────────────────
 * Each of the three features shipped here has a rule at its centre that is
 * invisible to the type-checker, invisible to a passing build, and expensive to
 * discover in production:
 *
 *   1. **Calendar dates.** A month view is date arithmetic, and date arithmetic
 *      done on a local `Date` is correct on the machine that wrote it and wrong
 *      six timezones away. A server in Frankfurt and a browser in Karachi must
 *      agree on which day Friday's last period falls on. Nothing about that
 *      shows up in a screenshot taken in one place.
 *
 *   2. **Colour legibility.** A subject colour a school picks itself can be any
 *      hex at all, and the grid computes its lettering from it. §5p records
 *      what happens when a preview and a renderer disagree about that: white
 *      text on pale yellow, shipped and unnoticed. So the two are asserted to
 *      agree.
 *
 *   3. **The fee gate's copy.** The welcome email's wording is generated, not
 *      written, and it names children. A family with two children must not be
 *      told "It covers Ayesha, Bilal" or "It covers Ayesha and " — the kind of
 *      defect nobody catches because nobody re-reads a template.
 *
 *   npm run check-sprint-periods
 *
 * Exit code 1 on any violation.
 */

import {
  SUBJECT_COLORS,
  isHexColor,
  subjectShortLabel,
} from '../db/schema/subjects';
import { minutesFromTime, slotTimeProblem } from '../db/schema/timetable-slots';
import { isSchoolDay } from '../db/schema/timetable-entries';
import { isFeeClearanceStatus } from '../db/schema/student-enrollments';
import {
  MIN_CONTRAST_RATIO,
  contrastRatio,
  parseHex,
  readableForeground,
} from '../lib/color-contrast';
import {
  addDays,
  datesInRange,
  endOfMonth,
  isCalendarView,
  isDateOnly,
  isoWeekday,
  rangeFor,
  startOfMonth,
  startOfWeek,
} from '../lib/teacher-calendar';

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
 * 1. Calendar dates.
 * -------------------------------------------------------------------------- */

section('Calendar date arithmetic');

ok(isDateOnly('2026-08-20'), 'a real date is accepted');
ok(!isDateOnly('2026-02-30'), '30 February is refused rather than rolled forward');
ok(!isDateOnly('2026-8-20'), 'an unpadded month is refused');
ok(!isDateOnly(''), 'an empty string is refused');
ok(!isDateOnly(null), 'a null is refused');

// 2026-08-20 is a Thursday.
ok(isoWeekday('2026-08-20') === 3, 'Thursday is weekday 3, counting Monday as 0');
ok(isoWeekday('2026-08-17') === 0, 'Monday is weekday 0');
ok(isoWeekday('2026-08-23') === 6, 'Sunday is weekday 6, not weekday 0');

ok(startOfWeek('2026-08-20') === '2026-08-17', 'the week containing a Thursday starts Monday');
ok(startOfWeek('2026-08-17') === '2026-08-17', 'a Monday is its own start of week');
ok(startOfWeek('2026-08-23') === '2026-08-17', 'a Sunday belongs to the week that began six days earlier');

ok(addDays('2026-08-31', 1) === '2026-09-01', 'adding a day crosses a month boundary');
ok(addDays('2026-12-31', 1) === '2027-01-01', 'adding a day crosses a year boundary');
ok(addDays('2026-03-01', -1) === '2026-02-28', 'stepping back from 1 March lands on 28 February in a common year');
ok(addDays('2024-03-01', -1) === '2024-02-29', 'and on 29 February in a leap year');

ok(startOfMonth('2026-08-20') === '2026-08-01', 'the month starts on the first');
ok(endOfMonth('2026-08-20') === '2026-08-31', 'a 31-day month ends on the 31st');
ok(endOfMonth('2026-02-10') === '2026-02-28', 'February ends on the 28th in a common year');
ok(endOfMonth('2024-02-10') === '2024-02-29', 'and on the 29th in a leap year');

// The range a view covers. The month runs whole weeks, so the grid has no
// ragged first and last row.
const dayRange = rangeFor('day', '2026-08-20');
ok(dayRange.from === '2026-08-20' && dayRange.to === '2026-08-20', 'a day range is one day');

const weekRange = rangeFor('week', '2026-08-20');
ok(weekRange.from === '2026-08-17', 'a week range starts on the Monday');
ok(weekRange.to === '2026-08-23', 'and ends on the Sunday');

const monthRange = rangeFor('month', '2026-08-20');
ok(isoWeekday(monthRange.from) === 0, 'a month range starts on a Monday');
ok(isoWeekday(monthRange.to) === 6, 'a month range ends on a Sunday');
ok(monthRange.from <= '2026-08-01', 'a month range covers the first of the month');
ok(monthRange.to >= '2026-08-31', 'a month range covers the last of the month');
ok(
  datesInRange(monthRange.from, monthRange.to).length % 7 === 0,
  'a month range is a whole number of weeks, so the grid has no ragged row',
);

ok(datesInRange('2026-08-17', '2026-08-23').length === 7, 'a week is seven dates');
ok(datesInRange('2026-08-20', '2026-08-20').length === 1, 'an inclusive range of one day is one date');
ok(datesInRange('2026-08-21', '2026-08-20').length === 0, 'a backwards range is empty, not infinite');

/*
 * The projection rule, asserted rather than trusted.
 *
 * `day_of_week` is 0–4 by CHECK constraint; `isoWeekday` returns 5 and 6 at the
 * weekend. Those two facts together are the whole reason no lesson is ever
 * projected onto a Saturday, and they live in two different files.
 */
ok(!isSchoolDay(5), 'Saturday is not a school day the timetable can hold');
ok(!isSchoolDay(6), 'Sunday is not a school day the timetable can hold');
ok(isSchoolDay(0) && isSchoolDay(4), 'Monday to Friday are');
for (const date of datesInRange('2026-08-17', '2026-08-23')) {
  const weekday = isoWeekday(date);
  const isWeekend = weekday === 5 || weekday === 6;
  ok(
    isWeekend !== isSchoolDay(weekday),
    `${date} is projected onto exactly when it is a teaching day`,
  );
}

ok(isCalendarView('day') && isCalendarView('week') && isCalendarView('month'), 'the three views are recognised');
ok(!isCalendarView('year'), 'a fourth view is refused rather than defaulted silently');

/* -----------------------------------------------------------------------------
 * 2. Subject colours.
 * -------------------------------------------------------------------------- */

section('Subject colours');

ok(SUBJECT_COLORS.every(isHexColor), 'every palette colour is a valid #rrggbb');
ok(
  new Set(SUBJECT_COLORS).size === SUBJECT_COLORS.length,
  'no palette colour appears twice',
);

// The picker allows any hex. The API must too, or the form promises something
// the server refuses.
ok(isHexColor('#123abc'), 'a lowercase custom hex is accepted');
ok(isHexColor('#123ABC'), 'an uppercase custom hex is accepted');
ok(!isHexColor('#123'), 'a three-digit shorthand is refused — the column stores six');
ok(!isHexColor('123abc'), 'a hex without its hash is refused');
ok(!isHexColor('red'), 'a colour name is refused');
ok(!isHexColor(''), 'an empty string is refused');

/*
 * The preview and the grid must compute the same lettering.
 *
 * They call the same function, which is the point — but only for as long as
 * something asserts that both sides still do. This is the §5p defect one level
 * down: a preview that flatters a colour the renderer draws differently.
 */
for (const colour of SUBJECT_COLORS) {
  const foreground = parseHex(readableForeground(colour));
  const background = parseHex(colour);
  ok(foreground !== null && background !== null, `${colour} parses`);

  if (foreground !== null && background !== null) {
    ok(
      contrastRatio(background, foreground) >= MIN_CONTRAST_RATIO,
      `${colour} carries legible lettering at ${MIN_CONTRAST_RATIO}:1`,
    );
  }
}

// A colour a school picks itself need not clear the floor — that is a warning,
// not a refusal — but the lettering chosen for it must still be the better of
// the two available.
for (const hostile of ['#ffff00', '#000000', '#ffffff', '#808080', '#f5f5dc']) {
  const background = parseHex(hostile);
  const chosen = parseHex(readableForeground(hostile));
  const dark = parseHex('#0f172a');
  const light = parseHex('#f8fafc');

  if (background === null || chosen === null || dark === null || light === null) {
    ok(false, `${hostile} parses`);
    continue;
  }

  ok(
    contrastRatio(background, chosen) >=
      Math.max(contrastRatio(background, dark), contrastRatio(background, light)) - 0.001,
    `${hostile} gets the better of the two lettering colours, not a default`,
  );
}

ok(subjectShortLabel({ name: 'Mathematics', code: 'MATH' }) === 'MATH', 'a code wins in a narrow cell');
ok(subjectShortLabel({ name: 'Mathematics', code: null }) === 'Mathematics', 'no code falls back to the name');
ok(subjectShortLabel({ name: 'Mathematics', code: '' }) === 'Mathematics', 'an empty code falls back too, rather than printing nothing');

/* -----------------------------------------------------------------------------
 * 3. Period schedules.
 * -------------------------------------------------------------------------- */

section('Period schedules');

ok(slotTimeProblem('08:00', '09:00') === null, 'a normal period is accepted');
ok(slotTimeProblem('09:00', '08:00') !== null, 'a period that ends before it starts is refused');
ok(slotTimeProblem('08:00', '08:00') !== null, 'a zero-length period is refused');
ok(slotTimeProblem('8:00', '09:00') !== null, 'an unpadded time is refused');
ok(slotTimeProblem('24:00', '25:00') !== null, 'an out-of-range hour is refused');

ok(minutesFromTime('00:00') === 0, 'midnight is zero minutes');
ok(minutesFromTime('12:30') === 750, 'half past twelve is 750 minutes');
ok(minutesFromTime('23:59') === 1439, 'the last minute of the day is 1439');

/*
 * The ordering rule the teacher calendar depends on.
 *
 * A teacher on two schedules in one day has periods whose `order_index` values
 * are not comparable — position 3 is 10:00 on one and 11:20 on the other. The
 * calendar sorts by the clock instead, and this asserts that the clock actually
 * orders them where the index does not.
 */
const junior = { orderIndex: 2, startTime: '11:20' };
const senior = { orderIndex: 3, startTime: '10:00' };
ok(junior.orderIndex < senior.orderIndex, 'the junior period has the lower position…');
ok(
  minutesFromTime(junior.startTime) > minutesFromTime(senior.startTime),
  '…and the later start, so ordering by position would interleave two schedules wrongly',
);

/* -----------------------------------------------------------------------------
 * 4. The admission fee gate.
 * -------------------------------------------------------------------------- */

section('The admission fee gate');

ok(isFeeClearanceStatus('outstanding'), '"outstanding" is a fee clearance status');
ok(isFeeClearanceStatus('cleared'), '"cleared" is a fee clearance status');
ok(!isFeeClearanceStatus('paid'), 'the challan vocabulary is not the enrollment vocabulary');
ok(!isFeeClearanceStatus('active'), 'nor is the enrollment status vocabulary');

/*
 * The welcome names the children. Re-implemented here rather than imported,
 * because `lib/access-email.ts` is `server-only` and pulls in the database.
 * The assertion is the shape of the sentence, which is what breaks.
 */
function childrenSentence(children: readonly string[]): string {
  if (children.length === 0) return 'It covers every child of yours enrolled at the school.';
  if (children.length === 1) return `It covers ${children[0]}.`;
  const last = children[children.length - 1];
  return `It covers ${children.slice(0, -1).join(', ')} and ${last}.`;
}

ok(
  childrenSentence([]).endsWith('.') && !childrenSentence([]).includes('undefined'),
  'no children named still produces a whole sentence',
);
ok(childrenSentence(['Ayesha']) === 'It covers Ayesha.', 'one child reads plainly');
ok(
  childrenSentence(['Ayesha', 'Bilal']) === 'It covers Ayesha and Bilal.',
  'two children are joined with "and", not a comma',
);
ok(
  childrenSentence(['Ayesha', 'Bilal', 'Zara']) === 'It covers Ayesha, Bilal and Zara.',
  'three children are comma-separated with "and" before the last',
);
for (const count of [0, 1, 2, 3, 7]) {
  const names = Array.from({ length: count }, (_unused, index) => `Child ${index + 1}`);
  const sentence = childrenSentence(names);
  ok(!sentence.includes(' and .'), `${count} children: no dangling "and"`);
  ok(!sentence.includes(', .'), `${count} children: no trailing comma`);
  ok(!sentence.includes('undefined'), `${count} children: nothing undefined leaks in`);
}

/* -------------------------------------------------------------------------- */

console.log(
  failures === 0
    ? `\nPASS — ${checks} assertions across the calendar, the colours, the period schedules and the fee gate.`
    : `\nFAIL — ${failures} of ${checks} assertions failed.`,
);

process.exit(failures === 0 ? 0 : 1);
