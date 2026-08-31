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
 *     SHOW_SQL=1 npm run check-portals    # every statement it actually issued
 *
 * ── What a nobody-tenant cannot do, and what this used to claim it did ───
 * A tenant owning no row makes most of these functions return at their first
 * guard, and until Sprint 21 this script printed `ok` for them anyway. Line 298
 * called `listPublishedTermsForStudent`, which returned `[]` at its enrolments
 * check and never built the `SELECT DISTINCT` behind it — a statement Postgres
 * refuses outright with 42P10 and had refused at every school since Sprint 13.
 * The gate had been green on SQL it had never once handed to a server.
 *
 * Reach is measured now: `countStatements` records the SQL of everything each
 * entry builds, and an entry may name the fragment that proves its own target
 * was among them. Anything that did not get there reports **not exercised**,
 * which is not a pass. It is also not a failure *here* — a nobody-tenant is
 * incapable of reaching them and that is the point of using one. Making the
 * guarded reads run for real is `npm run check-sprint21`'s job, and there a
 * statement not reached fails the build.
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
  getChildSnapshot,
  getStudentDay,
  getStudentSectionId,
  getTeacherClasses,
  getTeacherDay,
  getTeacherTasks,
  monthToDate,
  sectionRegisterFacts,
  sectionsMarkedOn,
  weekdayIndex,
} from '../lib/portal-dashboard';
import {
  listLeaveTypeOptions,
  listOwnLeave,
  listOwnPayslips,
  staffIdForSchoolUser,
} from '../lib/staff-self-queries';

/** A syntactically valid id that belongs to no tenant. */
const NOBODY = '00000000-0000-0000-0000-000000000000';
const NO_ONE = '00000000-0000-0000-0000-000000000001';

/**
 * A Wednesday, at 11:00.
 *
 * The three timetable reads short-circuit at the weekend — correctly, there
 * being no `day_of_week` for Saturday — which on a Sunday would leave the queries
 * behind them as the ones this script never runs. Two of every three runs would
 * pass without executing them, which is the worst kind of check.
 */
const MIDWEEK = new Date('2026-08-19T11:00:00');

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
 * Sprint 15 — the portal dashboards' own arithmetic, with no database.
 *
 * `weekdayIndex` decides which column of the timetable is "today". An off-by-one
 * shows a teacher Tuesday's periods on a Wednesday, and the screen is a
 * perfectly plausible day: right rooms, right subjects, wrong day. Nothing
 * about it looks broken, which is why it is asserted here rather than reviewed.
 * -------------------------------------------------------------------------- */

function checkPortalDay(): void {
  console.log('\nThe portal dashboards — no database:');

  // `timetable_entries.day_of_week` is 0 = Monday and runs to 4 = Friday.
  assert('Monday is column 0', weekdayIndex(new Date('2026-08-17T09:00:00')) === 0);
  assert('Wednesday is column 2', weekdayIndex(new Date('2026-08-19T09:00:00')) === 2);
  assert('Friday is column 4', weekdayIndex(new Date('2026-08-21T09:00:00')) === 4);
  assert('Saturday is not a school day', weekdayIndex(new Date('2026-08-22T09:00:00')) === null);
  assert('nor is Sunday', weekdayIndex(new Date('2026-08-23T09:00:00')) === null);

  const window = monthToDate(new Date(2026, 7, 19));
  assert('the month starts on the 1st', window.from === '2026-08-01');
  assert('and ends today, not at the month end', window.to === '2026-08-19');

  const firstOfMonth = monthToDate(new Date(2026, 7, 1));
  assert(
    'on the 1st the window is one day, not empty',
    firstOfMonth.from === '2026-08-01' && firstOfMonth.to === '2026-08-01',
  );
}

/* -----------------------------------------------------------------------------
 * Every new query, against the real schema.
 * -------------------------------------------------------------------------- */

/**
 * A query to execute, and — where the function guards it behind an earlier
 * read — a fragment of the statement that proves it was actually reached.
 *
 * The third element is what `check-sprint21` was opened for. Counting
 * statements is not enough on its own: `listPublishedTermsForStudent` issues
 * its enrolments lookup and *then* returns, so "it issued a statement" was true
 * of the run that never once handed Postgres the broken `SELECT DISTINCT`
 * underneath it. The fragment is matched against the SQL Drizzle generates, so
 * it is checked rather than asserted, and it is chosen from a `SHOW_SQL=1` run
 * rather than from reading the function.
 */
type QueryCheck = [name: string, run: () => Promise<unknown>, reaches?: string];

const CHECKS: QueryCheck[] = [
  ['getPrincipalModel', () => getPrincipalModel(NOBODY)],
  ['listPrincipalAssignments', () => listPrincipalAssignments(NOBODY)],
  ['listAssignablePrincipals', () => listAssignablePrincipals(NOBODY)],
  /*
   * The four entries whose target statement sits behind an earlier read, and
   * the SQL fragment that proves it was reached. Every fragment was taken from
   * a `SHOW_SQL=1` run, not from reading the function.
   *
   * `listPublishedTermsForStudent` is the one this whole mechanism exists for.
   * It issues its enrolments lookup, returns `[]` because a nobody-tenant has
   * none, and never builds the `SELECT DISTINCT … FROM exams` underneath —
   * which for two and a half years was a 42P10 no gate had ever executed.
   * `getChildSnapshot` fans out into the same function and loses the same leg.
   */
  [
    'listPublishedTermsForStudent',
    () => listPublishedTermsForStudent(NOBODY, NO_ONE),
    'from "exams"',
  ],
  // Past its published-term guard the section is looked up per term, so
  // reaching that read is the proof the guard let something through.
  [
    'getStudentReportCard',
    () => getStudentReportCard(NOBODY, NO_ONE, NO_ONE),
    'from "student_enrollments"',
  ],
  ['listStudentExams', () => listStudentExams(NOBODY, NO_ONE, NO_ONE), 'from "exams"'],
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

  /*
   * Sprint 15 — the three portal dashboards.
   *
   * Each of these fans out into four or five feature modules that know nothing
   * about each other, and the SQL underneath is the anti-join form ("classes
   * with no register today") that reads perfectly and returns everything the
   * day somebody puts a condition on the wrong side of the join. Nothing else
   * in this repository executes them: the portals cannot be signed into from a
   * development machine (`STATE.md` §5d).
   */
  ['getTeacherDay', () => getTeacherDay(NOBODY, NO_ONE, NO_ONE, MIDWEEK)],
  ['getTeacherTasks', () => getTeacherTasks(NOBODY, NO_ONE, NO_ONE, NO_ONE, MIDWEEK)],
  ['getTeacherClasses', () => getTeacherClasses(NOBODY, NO_ONE, NO_ONE)],
  ['getChildSnapshot', () => getChildSnapshot(NOBODY, NO_ONE, NO_ONE, MIDWEEK), 'from "exams"'],
  ['getStudentSectionId', () => getStudentSectionId(NOBODY, NO_ONE, NO_ONE)],
  ['getStudentDay', () => getStudentDay(NOBODY, NO_ONE, NO_ONE, MIDWEEK)],

  /*
   * The two anti-joins behind "My classes" and "registers not taken", called
   * directly with a section id.
   *
   * `getTeacherClasses` and `getTeacherTasks` above both reach a school with no
   * sections and stop before these run — correctly, since `in ()` can only
   * return nothing — which would leave the joins they contain as the queries
   * this script never executed. Handing them an id belonging to no section
   * makes Postgres parse, plan and run them while reading nothing.
   */
  ['sectionsMarkedOn', () => sectionsMarkedOn(NOBODY, [NO_ONE], '2026-08-19')],
  ['sectionRegisterFacts', () => sectionRegisterFacts(NOBODY, NO_ONE, [NO_ONE])],
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

/**
 * Counts the statements one check actually builds.
 *
 * ── Why this had to be added, and what it cost not to have it ────────────
 * Every entry below runs against `NOBODY`, a tenant that owns no row. Most of
 * these functions read something first and return early when it is empty —
 * correctly — which means the statement the entry exists to exercise is often
 * never issued at all. This script printed `ok` for those anyway, and had done
 * since Sprint 13.
 *
 * What was hiding behind one of them was `listPublishedTermsForStudent`, a
 * `SELECT DISTINCT` ordered by a column that was not in its select list.
 * Postgres refuses that at plan time — 42P10 — so it had **never returned a row
 * at any school**, and it took `/student/results`, `/parent/results` and the
 * results panel of every child card on the parent dashboard with it. This gate
 * reported it green for two and a half years, on line 298, because the function
 * returned `[]` at its `enrolments.length === 0` guard before Postgres was ever
 * asked anything.
 *
 * So reach is now *measured*, not assumed. `lib/drizzle.ts` exports `getDb()`
 * and every module under test resolves `db` through the same instance, so
 * wrapping its builder methods counts what each check asks the database for. A
 * builder is counted when it is created rather than when it resolves — nothing
 * in this codebase builds a statement it does not await, and counting at
 * creation is what makes an early return distinguishable from an empty result.
 *
 * ── Not exercised is not a failure here, and that is deliberate ──────────
 * A nobody-tenant *cannot* reach most of these; that is the point of using one.
 * Turning them red would say the script is broken when what is true is that it
 * is narrow. `npm run check-sprint21` is the gate that executes the portal
 * reads against a tenant and a student that exist, and it fails when a
 * statement is not reached. This one now says which of its entries it is
 * entitled to have an opinion about.
 */
function countStatements(database: object): () => string[] {
  const issued: string[] = [];

  const hasToSql = (value: unknown): boolean =>
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { toSQL?: unknown }).toSQL === 'function';

  /**
   * Follows a Drizzle builder to the point it is awaited, then records its SQL.
   *
   * Three facts about Drizzle's builders shape this, and all three were
   * established by watching it rather than by reading it:
   *
   *   · a builder cannot be asked for its SQL when it is created — `db.select()`
   *     has no `FROM` yet — so the read happens when `then` is fetched, which is
   *     the last moment before the statement reaches the driver;
   *   · `.from()` returns a **new** object rather than `this`, so a wrapper that
   *     only re-wraps its own identity is lost on the first chained call. That
   *     is why anything with a `toSQL` coming back out is re-wrapped;
   *   · everything else coming back out is left alone. A builder is thenable, so
   *     "is it a promise" cannot be used to tell the two apart, and wrapping the
   *     awaited promise would file one statement twice.
   */
  const track = (builder: object): object =>
    new Proxy(builder, {
      get(target, property, receiver) {
        if (property === 'then' && hasToSql(target)) {
          try {
            issued.push((target as { toSQL: () => { sql: string } }).toSQL().sql);
          } catch {
            issued.push('(toSQL threw)');
          }
        }

        const value = Reflect.get(target, property, receiver) as unknown;

        if (typeof value === 'function') {
          const fn = value as (...args: unknown[]) => unknown;
          return (...args: unknown[]): unknown => {
            const result = fn.apply(target, args);
            return result === target || hasToSql(result)
              ? track(result as object)
              : result;
          };
        }

        return value;
      },
    });

  const methods = [
    'select',
    'selectDistinct',
    'selectDistinctOn',
    'insert',
    'update',
    'delete',
    'execute',
  ] as const;

  const target = database as Record<string, unknown>;

  for (const method of methods) {
    const original = target[method];
    if (typeof original !== 'function') continue;
    const fn = original as (...args: unknown[]) => unknown;
    target[method] = (...args: unknown[]): unknown => {
      const built = fn.apply(database, args);
      if (method === 'execute') {
        issued.push('(execute)');
        return built;
      }
      return typeof built === 'object' && built !== null ? track(built) : built;
    };
  }

  return () => [...issued];
}

async function main(): Promise<void> {
  checkCalendar();
  checkWeeks();
  checkScope();
  checkPortalDay();

  const pureFailures = failures;

  console.log('\nSprint 13 queries against the real schema:');
  loadDatabaseUrl();

  const { getDb } = await import('../lib/drizzle');
  const issuedSoFar = countStatements(getDb());

  let queryFailures = 0;
  let notExercised = 0;
  let before = issuedSoFar().length;

  for (const [name, run, reaches] of CHECKS) {
    try {
      const started = Date.now();
      const result = await run();
      const elapsed = String(Date.now() - started).padStart(5);
      const all = issuedSoFar();
      const statements = all.slice(before);
      before = all.length;

      if (process.env.SHOW_SQL === '1') {
        for (const statement of statements) console.log(`       · ${statement}`);
      }

      const missed =
        statements.length === 0
          ? 'it returned before issuing a single statement'
          : reaches !== undefined &&
              !statements.some((statement) => statement.toLowerCase().includes(reaches))
            ? `it issued ${String(statements.length)} statement(s), none of them the one containing \`${reaches}\``
            : null;

      if (missed !== null) {
        notExercised += 1;
        console.log(`  --   ${name.padEnd(28)} ${elapsed}ms  NOT EXERCISED — ${missed}`);
        continue;
      }

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
        `  ok   ${name.padEnd(28)} ${elapsed}ms  ${String(statements.length).padStart(2)} stmt  ${shape}`,
      );
    } catch (caught) {
      before = issuedSoFar().length;
      queryFailures += 1;
      console.log(`  FAIL ${name}`);
      console.log(`       ${caught instanceof Error ? caught.message : String(caught)}`);
    }
  }

  const exercised = CHECKS.length - queryFailures - notExercised;

  if (notExercised > 0) {
    console.log(
      `\n  ${String(notExercised)} of ${CHECKS.length} entries never reached the statement they exist to exercise. A tenant that\n  owns no row cannot get past their guards, so this gate has no opinion about their SQL and\n  now says so instead of printing ok. \`npm run check-sprint21\` runs the portal reads against\n  a tenant and a student that exist, and there a statement not reached is a failure.`,
    );
  }

  if (queryFailures > 0) {
    console.log(`\nFAIL — ${queryFailures} of ${CHECKS.length} queries could not execute.`);
  } else if (pureFailures > 0) {
    console.log(
      `\nFAIL — every query that ran executed, but ${pureFailures} assertion(s) about the calendar, the week snapping or the principal scope did not hold.`,
    );
  } else {
    console.log(
      `\nPASS — ${exercised} of ${CHECKS.length} queries reached the database and executed, and the calendar, week snapping and principal scope all hold.`,
    );
  }

  process.exitCode = pureFailures + queryFailures === 0 ? 0 : 1;
}

void main();
