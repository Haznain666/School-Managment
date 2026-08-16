/**
 * Sprint 13's gate — the calendar arithmetic, the principal resolver, and every
 * new query executed against the real schema.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * Three of the things this sprint added fail in a way that renders perfectly.
 *
 *   1. **The attendance calendar.** An off-by-one in the leading blanks shifts
 *      every date by a day and the grid still looks exactly like a calendar.
 *      Nobody reviewing a screenshot would catch it; a parent would eventually
 *      notice their child was marked absent on a Sunday.
 *   2. **The principal scope.** `resolvePrincipalScope` unions several
 *      assignments, and `null` on either axis means "everything". Getting the
 *      union backwards makes a second assignment *narrow* the first — a head
 *      quietly loses half their school, and the screen that results is simply a
 *      shorter list.
 *   3. **The new SQL.** Same reasoning as `check-dashboard`: a typo inside a
 *      `sql` template compiles and fails at the first request, and the portals
 *      cannot be signed into from a development machine (`STATE.md` §5d).
 *
 * So the two pure modules are asserted with no database, and then every new
 * query is executed once against the live schema with a location id belonging
 * to nobody — enough for Postgres to parse it, resolve every column and run it,
 * while reading no real school's data.
 *
 *     npm run check-portals
 */

import { readFileSync } from 'node:fs';

import {
  buildCalendarMonth,
  daysInMonth,
  mondayIndex,
  monthBounds,
  parseMonthParam,
  shiftMonth,
} from '../lib/attendance-calendar';
import { isMonday, weekStartingOf, listOwnPlans, listSharedPlans } from '../lib/lesson-plan-queries';
import { getNotificationSettings, filterByEmailPreference } from '../lib/notification-preferences';
import {
  describeScope,
  listAssignablePrincipals,
  listPrincipalAssignments,
  getPrincipalModel,
  scopeAdmitsBranch,
  scopeAdmitsGrade,
  UNSCOPED,
  type PrincipalScope,
} from '../lib/principal-resolver';
import {
  getStudentReportCard,
  listPublishedTermsForStudent,
  listStudentExams,
} from '../lib/portal-results';
import {
  listLeaveTypeOptions,
  listOwnLeave,
  listOwnPayslips,
  staffIdForSchoolUser,
} from '../lib/staff-self-queries';

/** A syntactically valid id that belongs to no tenant. */
const NOBODY = '00000000-0000-0000-0000-000000000000';
const NO_ONE = '00000000-0000-0000-0000-000000000001';

let failures = 0;

function assert(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  ok   ${label}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}`);
}

/* -----------------------------------------------------------------------------
 * The calendar, with no database.
 * -------------------------------------------------------------------------- */

function checkCalendar(): void {
  console.log('\nThe attendance calendar — no database:');

  assert('February 2026 has 28 days', daysInMonth(2026, 2) === 28);
  assert('February 2024 has 29 days', daysInMonth(2024, 2) === 29);
  assert('December has 31 days', daysInMonth(2026, 12) === 31);

  // 2026-08-16 is a Sunday, so Monday-first index 6. This is the assertion the
  // whole grid rests on: get it wrong and every date shifts by a day.
  assert('Sunday is index 6', mondayIndex('2026-08-16') === 6);
  assert('Monday is index 0', mondayIndex('2026-08-17') === 0);
  assert('Saturday is index 5', mondayIndex('2026-08-15') === 5);

  assert('December rolls into January', shiftMonth(2026, 12, 1) === '2027-01');
  assert('January rolls back into December', shiftMonth(2026, 1, -1) === '2025-12');
  assert('a year forward', shiftMonth(2026, 8, 12) === '2027-08');

  assert(
    'month bounds cover the whole month',
    monthBounds(2026, 2).from === '2026-02-01' && monthBounds(2026, 2).to === '2026-02-28',
  );

  const fallback = { year: 2026, month: 8 };
  assert('a good month parses', parseMonthParam('2026-03', fallback).month === 3);
  assert('month 13 falls back', parseMonthParam('2026-13', fallback).month === 8);
  assert('junk falls back', parseMonthParam('nonsense', fallback).month === 8);
  assert('absent falls back', parseMonthParam(undefined, fallback).month === 8);

  // August 2026 starts on a Saturday, so the first row carries five blanks.
  const august = buildCalendarMonth(2026, 8, [], '2026-08-16');
  assert('every row has seven cells', august.weeks.every((week) => week.length === 7));
  assert(
    'the 1st sits under Saturday',
    august.weeks[0]?.filter((day) => day === null).length === 5,
  );
  assert(
    'every day of the month is present exactly once',
    august.weeks.flat().filter((day) => day !== null).length === 31,
  );
  assert(
    'the last cell is the 31st',
    august.weeks.flat().filter((day) => day !== null).at(-1)?.dayOfMonth === 31,
  );

  const marked = buildCalendarMonth(
    2026,
    8,
    [
      { date: '2026-08-03', status: 'absent', notes: 'Fever' },
      { date: '2026-08-04', status: 'present', notes: null },
    ],
    '2026-08-16',
  );
  const days = marked.weeks.flat().filter((day) => day !== null);

  assert(
    'a marked day carries its status',
    days.find((day) => day.date === '2026-08-03')?.status === 'absent',
  );
  assert(
    'an unmarked school day is null, never absent',
    days.find((day) => day.date === '2026-08-05')?.status === null,
  );
  assert(
    'a future day is flagged',
    days.find((day) => day.date === '2026-08-20')?.isFuture === true,
  );
  assert(
    'a past day is not flagged future',
    days.find((day) => day.date === '2026-08-03')?.isFuture === false,
  );
  assert(
    'Saturday is a weekend',
    days.find((day) => day.date === '2026-08-01')?.isWeekend === true,
  );
  assert(
    'Monday is not a weekend',
    days.find((day) => day.date === '2026-08-03')?.isWeekend === false,
  );
}

/* -----------------------------------------------------------------------------
 * Lesson-plan week snapping, with no database.
 * -------------------------------------------------------------------------- */

function checkWeeks(): void {
  console.log('\nLesson-plan weeks — no database:');

  assert('a Sunday snaps back to Monday', weekStartingOf('2026-08-16') === '2026-08-10');
  assert('a Monday is its own week', weekStartingOf('2026-08-17') === '2026-08-17');
  assert('a Friday snaps back', weekStartingOf('2026-08-21') === '2026-08-17');
  assert('snapping across a month', weekStartingOf('2026-09-02') === '2026-08-31');
  assert('Monday is recognised', isMonday('2026-08-17'));
  assert('Sunday is not', !isMonday('2026-08-16'));
}

/* -----------------------------------------------------------------------------
 * The principal scope, with no database.
 *
 * This is the pivotal one. Two assignments must widen, never narrow.
 * -------------------------------------------------------------------------- */

function scope(partial: Partial<PrincipalScope>): PrincipalScope {
  return { ...UNSCOPED, scoped: true, ...partial };
}

function checkScope(): void {
  console.log('\nThe principal scope — no database:');

  assert('unscoped admits any branch', scopeAdmitsBranch(UNSCOPED, 'anything'));
  assert('unscoped admits any grade', scopeAdmitsGrade(UNSCOPED, 'anything'));

  const oneCampus = scope({ branchIds: ['main'], gradeIds: ['g1', 'g2'] });
  assert('a scoped head admits their campus', scopeAdmitsBranch(oneCampus, 'main'));
  assert('and refuses another', !scopeAdmitsBranch(oneCampus, 'other'));
  assert('admits their grade', scopeAdmitsGrade(oneCampus, 'g1'));
  assert('and refuses another', !scopeAdmitsGrade(oneCampus, 'g9'));

  // A record tied to no campus belongs to the school, so every head sees it.
  // Refusing it would hide school-wide rows from all of them.
  assert('a school-wide record is admitted', scopeAdmitsBranch(oneCampus, null));
  assert('a grade-less record is admitted', scopeAdmitsGrade(oneCampus, null));

  // `null` on an axis means everything on that axis, independently.
  const everyCampusOneDivision = scope({ branchIds: null, gradeIds: ['g1'] });
  assert(
    'null branches admit every campus',
    scopeAdmitsBranch(everyCampusOneDivision, 'anywhere'),
  );
  assert(
    'while the grade list still narrows',
    !scopeAdmitsGrade(everyCampusOneDivision, 'g9'),
  );

  // The unassigned head: empty arrays, not null. Empty must match nothing.
  const unassigned = scope({ branchIds: [], gradeIds: [], unassigned: true });
  assert('an unassigned head admits no campus', !scopeAdmitsBranch(unassigned, 'main'));
  assert('and no grade', !scopeAdmitsGrade(unassigned, 'g1'));
  assert(
    'and is told who to ask',
    (describeScope(unassigned) ?? '').includes('school administrator'),
  );

  assert('an unscoped person is told nothing', describeScope(UNSCOPED) === null);
  assert(
    'a head is told what they are seeing',
    (describeScope(scope({ branchIds: ['m'], gradeIds: ['g1'], divisions: ['O-Levels'] })) ??
      '').includes('O-Levels'),
  );
  assert(
    'an empty division says so',
    (describeScope(scope({ branchIds: ['m'], gradeIds: [], divisions: ['O-Levels'] })) ??
      '').includes('no classes'),
  );
}

/* -----------------------------------------------------------------------------
 * Every new query, against the real schema.
 * -------------------------------------------------------------------------- */

const CHECKS: Array<[string, () => Promise<unknown>]> = [
  ['getPrincipalModel', () => getPrincipalModel(NOBODY)],
  ['listPrincipalAssignments', () => listPrincipalAssignments(NOBODY)],
  ['listAssignablePrincipals', () => listAssignablePrincipals(NOBODY)],
  ['listPublishedTermsForStudent', () => listPublishedTermsForStudent(NOBODY, NO_ONE)],
  ['getStudentReportCard', () => getStudentReportCard(NOBODY, NO_ONE, NO_ONE)],
  ['listStudentExams', () => listStudentExams(NOBODY, NO_ONE, NO_ONE)],
  [
    'listOwnPlans',
    () => listOwnPlans(NOBODY, NO_ONE, { from: '2026-01-01', to: '2026-12-31' }),
  ],
  [
    'listSharedPlans',
    () => listSharedPlans(NOBODY, { from: '2026-01-01', to: '2026-12-31' }),
  ],
  ['getNotificationSettings', () => getNotificationSettings(NOBODY, NO_ONE)],
  ['filterByEmailPreference', () => filterByEmailPreference(NOBODY, [NO_ONE], 'fees')],
  ['staffIdForSchoolUser', () => staffIdForSchoolUser(NOBODY, NO_ONE)],
  ['listOwnPayslips', () => listOwnPayslips(NOBODY, NO_ONE)],
  ['listOwnLeave', () => listOwnLeave(NOBODY, NO_ONE)],
  ['listLeaveTypeOptions', () => listLeaveTypeOptions(NOBODY)],
];

function loadDatabaseUrl(): void {
  if (process.env.DATABASE_URL !== undefined) return;

  for (const candidate of [
    'D:/School-Management-System/.env.local',
    '../../../.env.local',
    '.env.local',
  ]) {
    try {
      const text = readFileSync(candidate, 'utf8');
      const match = /^DATABASE_URL=(.*)$/m.exec(text);
      if (match?.[1] !== undefined) {
        process.env.DATABASE_URL = match[1].trim().replace(/^['"]|['"]$/g, '');
        console.log(`  using DATABASE_URL from ${candidate}`);
        return;
      }
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error('DATABASE_URL not found — set it, or run from a checkout with .env.local');
}

async function main(): Promise<void> {
  checkCalendar();
  checkWeeks();
  checkScope();

  const pureFailures = failures;

  console.log('\nSprint 13 queries against the real schema:');
  loadDatabaseUrl();

  let queryFailures = 0;

  for (const [name, run] of CHECKS) {
    try {
      const started = Date.now();
      const result = await run();
      const shape = Array.isArray(result)
        ? `${result.length} row(s)`
        : result === null
          ? 'null'
          : result instanceof Set
            ? `${result.size} kept`
            : typeof result === 'object'
              ? Object.keys(result as object).join(', ')
              : String(result);
      console.log(
        `  ok   ${name.padEnd(28)} ${String(Date.now() - started).padStart(5)}ms  ${shape}`,
      );
    } catch (caught) {
      queryFailures += 1;
      console.log(`  FAIL ${name}`);
      console.log(`       ${caught instanceof Error ? caught.message : String(caught)}`);
    }
  }

  if (queryFailures > 0) {
    console.log(`\nFAIL — ${queryFailures} of ${CHECKS.length} queries could not execute.`);
  } else if (pureFailures > 0) {
    console.log(
      `\nFAIL — every query executed, but ${pureFailures} assertion(s) about the calendar, the week snapping or the principal scope did not hold.`,
    );
  } else {
    console.log(
      `\nPASS — ${CHECKS.length} queries executed against the real schema, and the calendar, week snapping and principal scope all hold.`,
    );
  }

  process.exitCode = pureFailures + queryFailures === 0 ? 0 : 1;
}

void main();
