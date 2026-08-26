/**
 * Executes every dashboard aggregate against the real database.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * The dashboard queries carry hand-written SQL fragments — `filter (where …)`,
 * `case when … end`, `to_char`, `::date - 30`. TypeScript checks none of that;
 * a typo inside a `sql` template compiles perfectly and fails at the first
 * request, which on these screens means the dashboard a head teacher opens.
 * Nothing else in this repo would have caught it before a browser did, and the
 * portals cannot be signed into from a development machine (STATE.md §5d).
 *
 * So each query is run once. It is passed a location id that matches no school,
 * which is the point: every aggregate returns empty or zero, no real school's
 * data is read, and the SQL still has to parse, resolve every column and
 * execute. Syntax and schema errors surface; nothing else is touched.
 *
 *     npm run check-dashboard
 *
 * Reads `DATABASE_URL` from the main checkout's `.env.local`, because the
 * worktree has no env of its own.
 *
 * ── And one thing SQL cannot check ───────────────────────────────────────
 * The exam aggregates are the only ones Postgres does not answer on its own: a
 * grade band belongs to the school, so the marks are folded here, in
 * TypeScript, through the same `resolveBand` the report card calls. A pass rate
 * that counted absentees, or a distribution quietly bucketed by fixed
 * percentages, would compile, execute and disagree with the document printed
 * from the same marks. So the fold is asserted first, with no database at all.
 */

import { readFileSync } from 'node:fs';

import {
  getAdmissionsFunnel,
  getAgingBuckets,
  getAttendanceAverage,
  getAttendanceByClass,
  getAttendanceTrend,
  getClassStrength,
  getCollectionComparison,
  getCollectionTrend,
  getEnrolmentComparison,
  getSetupProgress,
  getExamPerformance,
  getFeeStatusSplit,
  getOutstandingSummary,
  getRecentExamOutcomes,
  getTodaySnapshot,
  distribute,
  foldStudentTotals,
  readExamMarks,
  type AggregateScope,
  type FoldableResult,
} from '../lib/dashboard-queries';
import {
  getDashboardExceptions,
  resolveDashboardScope,
} from '../lib/school-dashboard';
import {
  getActiveSchoolCount,
  getEmailHealth,
  getPlatformStudentCount,
  getProvisioningSplit,
  getSchoolsByCity,
  getStudentsBySchool,
  getTenantGrowth,
  listRecentSchools,
  listTenantsNeedingAttention,
} from '../lib/platform-dashboard';
import { UNSCOPED, type PrincipalScope } from '../lib/principal-resolver';
import type { ResolvedBand } from '../lib/grading';

/** A syntactically valid id that belongs to no tenant. */
const NOBODY = '00000000-0000-0000-0000-000000000000';

/**
 * An exam and a paper belonging to nobody, for the same reason.
 *
 * The two exam aggregates short-circuit on a school with no exams — correctly,
 * since an `in ()` can only return nothing — which would leave the one query
 * that reads `exam_results` as the one query this script never ran. So the
 * marks read is registered directly, with a paper id that matches no paper.
 */
const NO_EXAM = '00000000-0000-0000-0000-000000000001';
const NO_PAPER = '00000000-0000-0000-0000-000000000002';

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
 * A grade list belonging to nobody.
 *
 * Sprint 15 gave every aggregate an optional `AggregateScope`, and the scoped
 * path is *different SQL* — a correlated sub-select against
 * `student_enrollments` or `fee_challans` that the unscoped path never issues.
 * Running only the unscoped form would leave the half of this module that a
 * principal actually sees unexecuted, which is exactly the gap this script was
 * written to close.
 *
 * The empty-scope case is not registered, deliberately: it short-circuits in
 * TypeScript before reaching Postgres and there is no SQL for it to check.
 */
const NO_GRADE = '00000000-0000-0000-0000-000000000003';
const SCOPED: AggregateScope = { gradeIds: [NO_GRADE] };

/** A principal at a school that does not exist, for the scope resolver. */
const SCOPED_PRINCIPAL: PrincipalScope = {
  scoped: true,
  branchIds: [NO_PAPER],
  gradeIds: [NO_GRADE],
  divisions: ['O-Levels'],
  unassigned: false,
};

const CHECKS: Array<[string, () => Promise<unknown>]> = [
  ['getCollectionTrend', () => getCollectionTrend(NOBODY)],
  ['getFeeStatusSplit', () => getFeeStatusSplit(NOBODY)],
  ['getAgingBuckets', () => getAgingBuckets(NOBODY)],
  ['getAttendanceTrend', () => getAttendanceTrend(NOBODY)],
  ['getAttendanceByClass', () => getAttendanceByClass(NOBODY)],
  ['getClassStrength', () => getClassStrength(NOBODY)],
  ['getAdmissionsFunnel', () => getAdmissionsFunnel(NOBODY)],
  ['getTodaySnapshot', () => getTodaySnapshot(NOBODY)],
  ['getExamPerformance', () => getExamPerformance(NOBODY, NO_EXAM)],
  ['getRecentExamOutcomes', () => getRecentExamOutcomes(NOBODY)],
  ['readExamMarks', () => readExamMarks(NOBODY, [NO_PAPER])],

  // Sprint 15 — the comparisons behind the headline tiles.
  ['getCollectionComparison', () => getCollectionComparison(NOBODY)],
  ['getOutstandingSummary', () => getOutstandingSummary(NOBODY)],
  ['getAttendanceAverage', () => getAttendanceAverage(NOBODY)],
  ['getEnrolmentComparison', () => getEnrolmentComparison(NOBODY)],
  // Sprint 16. Six counts over six unrelated tables, so it is registered here
  // for the same reason as every other aggregate: the scoped path is different
  // SQL that the unscoped path never issues.
  ['getSetupProgress', () => getSetupProgress(NOBODY)],

  // Sprint 15 — BR4. Every aggregate again, through the scoped sub-selects.
  ['resolveDashboardScope (unscoped)', () => resolveDashboardScope(NOBODY, UNSCOPED)],
  ['resolveDashboardScope (scoped)', () => resolveDashboardScope(NOBODY, SCOPED_PRINCIPAL)],
  ['getCollectionTrend scoped', () => getCollectionTrend(NOBODY, SCOPED)],
  ['getFeeStatusSplit scoped', () => getFeeStatusSplit(NOBODY, SCOPED)],
  ['getAgingBuckets scoped', () => getAgingBuckets(NOBODY, SCOPED)],
  ['getAttendanceTrend scoped', () => getAttendanceTrend(NOBODY, SCOPED)],
  ['getAttendanceByClass scoped', () => getAttendanceByClass(NOBODY, SCOPED)],
  ['getClassStrength scoped', () => getClassStrength(NOBODY, SCOPED)],
  ['getAdmissionsFunnel scoped', () => getAdmissionsFunnel(NOBODY, SCOPED)],
  ['getTodaySnapshot scoped', () => getTodaySnapshot(NOBODY, SCOPED)],
  ['getRecentExamOutcomes scoped', () => getRecentExamOutcomes(NOBODY, 6, SCOPED)],
  ['getCollectionComparison scoped', () => getCollectionComparison(NOBODY, SCOPED)],
  ['getOutstandingSummary scoped', () => getOutstandingSummary(NOBODY, SCOPED)],
  ['getAttendanceAverage scoped', () => getAttendanceAverage(NOBODY, SCOPED)],
  ['getEnrolmentComparison scoped', () => getEnrolmentComparison(NOBODY, SCOPED)],
  ['getSetupProgress scoped', () => getSetupProgress(NOBODY, SCOPED)],

  // Sprint 15 — the exceptions strip. Every gate on, so all five run.
  [
    'getDashboardExceptions',
    () =>
      getDashboardExceptions(
        NOBODY,
        { gradeIds: null },
        { fees: true, attendance: true, exams: true, hr: true, email: true },
        { academicYearId: NO_EXAM, overdueChallans: 0 },
      ),
  ],
  [
    'getDashboardExceptions scoped',
    () =>
      getDashboardExceptions(
        NOBODY,
        SCOPED,
        { fees: true, attendance: true, exams: true, hr: true, email: true },
        { academicYearId: NO_EXAM, overdueChallans: 0 },
      ),
  ],

  // Sprint 15 — the Super Admin dashboard. These take no location id: the
  // subject is the estate and the guard is the super-admin session, so they are
  // run as they are actually called and simply read whatever is there.
  ['getActiveSchoolCount', () => getActiveSchoolCount()],
  ['getPlatformStudentCount', () => getPlatformStudentCount()],
  ['listTenantsNeedingAttention', () => listTenantsNeedingAttention()],
  ['getProvisioningSplit', () => getProvisioningSplit()],
  ['getSchoolsByCity', () => getSchoolsByCity()],
  ['getStudentsBySchool', () => getStudentsBySchool()],
  ['getTenantGrowth', () => getTenantGrowth()],
  ['listRecentSchools', () => listRecentSchools()],
  ['getEmailHealth', () => getEmailHealth()],
];

/* -----------------------------------------------------------------------------
 * The fold, asserted without a database.
 * -------------------------------------------------------------------------- */

/** Two papers out of 100, passing at 33 — the shape most exams have. */
const PAPERS = [
  { id: 'p1', resitStatus: 'none' as const, maxMarks: 100, passingMarks: 33 },
  { id: 'p2', resitStatus: 'none' as const, maxMarks: 100, passingMarks: 33 },
];

function mark(
  paper: string,
  student: string,
  value: number | null,
  attempt = 1,
): FoldableResult {
  return {
    examSubjectId: paper,
    studentProfileId: student,
    attempt,
    marksObtained: value === null ? null : value.toFixed(2),
    isAbsent: value === null,
  };
}

const MARKS: FoldableResult[] = [
  mark('p1', 'a', 90), mark('p2', 'a', 80), // 85%
  mark('p1', 'b', 75), mark('p2', 'b', 67), // 71%
  mark('p1', 'c', 95), mark('p2', 'c', null), // absent from one paper
  mark('p1', 'd', 60), mark('p2', 'd', 20), // 40%, failed one paper
  mark('p1', 'e', 50), // never marked on the second paper
];

/** A Matric ladder. */
const MATRIC: ResolvedBand[] = [
  { label: 'A+', minPercentage: 80, maxPercentage: 100, gpa: 4, remark: null },
  { label: 'A', minPercentage: 70, maxPercentage: 79.99, gpa: 3.7, remark: null },
  { label: 'B', minPercentage: 60, maxPercentage: 69.99, gpa: 3, remark: null },
  { label: 'C', minPercentage: 40, maxPercentage: 59.99, gpa: 2, remark: null },
];

/** The same marks at a school that grades ten points harder. */
const STRICT: ResolvedBand[] = [
  { label: 'A*', minPercentage: 90, maxPercentage: 100, gpa: 4, remark: null },
  { label: 'A', minPercentage: 80, maxPercentage: 89.99, gpa: 3.7, remark: null },
  { label: 'B', minPercentage: 70, maxPercentage: 79.99, gpa: 3, remark: null },
  { label: 'C', minPercentage: 60, maxPercentage: 69.99, gpa: 2, remark: null },
];

function checkFold(): number {
  let failed = 0;

  const assert = (name: string, actual: unknown, wanted: unknown): void => {
    if (JSON.stringify(actual) === JSON.stringify(wanted)) {
      console.log(`  ok   ${name}`);
      return;
    }
    failed += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       got  ${JSON.stringify(actual)}`);
    console.log(`       want ${JSON.stringify(wanted)}`);
  };

  const totals = foldStudentTotals(PAPERS, MARKS);

  assert('only fully-marked students are graded', totals.graded, 3);
  assert('absent from a paper — excluded', totals.absent, 1);
  assert('never marked on a paper — excluded', totals.unmarked, 1);
  assert('overall percentages', [...totals.percentages].sort(), [40, 71, 85]);
  assert('passing means passing every paper', totals.passed, 2);

  const matric = distribute(totals.percentages, MATRIC);
  const strict = distribute(totals.percentages, STRICT);

  // The whole point of folding in TypeScript rather than bucketing in SQL.
  assert('a Matric school sees A+ / A / — / C', matric.distribution, [
    { label: 'A+', value: 1 },
    { label: 'A', value: 1 },
    { label: 'B', value: 0 },
    { label: 'C', value: 1 },
  ]);
  assert('the same marks at a stricter school are not the same chart', strict.distribution, [
    { label: 'A*', value: 0 },
    { label: 'A', value: 1 },
    { label: 'B', value: 1 },
    { label: 'C', value: 0 },
  ]);
  assert('below every band is counted, never invented into a fail', strict.ungraded, 1);
  assert('and is zero where the ladder reaches down', matric.ungraded, 0);

  const resitPapers = [PAPERS[0]!, { ...PAPERS[1]!, resitStatus: 'published' as const }];
  const draftPapers = [PAPERS[0]!, { ...PAPERS[1]!, resitStatus: 'draft' as const }];
  const withResit = [...MARKS, mark('p2', 'd', 70, 2)];

  assert(
    'a published re-sit replaces the original',
    foldStudentTotals(resitPapers, withResit).passed,
    3,
  );
  assert(
    'one still being marked does not',
    foldStudentTotals(draftPapers, withResit).passed,
    2,
  );

  return failed;
}

/* -----------------------------------------------------------------------------
 * The scope short-circuits, asserted without a database.
 *
 * These are the two branches of `resolveDashboardScope` that never reach
 * Postgres, and they are the two that matter most. Getting the unassigned case
 * backwards — treating "no assignment" as "no filter" — hands a head the whole
 * school's finances, and the screen that results looks entirely normal.
 * -------------------------------------------------------------------------- */

async function checkScopeShortCircuits(): Promise<number> {
  let failed = 0;

  const assert = (name: string, condition: boolean): void => {
    if (condition) {
      console.log(`  ok   ${name}`);
      return;
    }
    failed += 1;
    console.log(`  FAIL ${name}`);
  };

  const unscoped = await resolveDashboardScope(NOBODY, UNSCOPED);
  assert('an unscoped reader narrows nothing', unscoped.gradeIds === null);
  assert('and is not flagged unassigned', !unscoped.unassigned);

  const unassigned = await resolveDashboardScope(NOBODY, {
    scoped: true,
    branchIds: [],
    gradeIds: [],
    divisions: [],
    unassigned: true,
  });
  assert('an unassigned head reaches no grade', unassigned.gradeIds?.length === 0);
  assert('and is flagged so the page can say why', unassigned.unassigned);

  const runsEverything = await resolveDashboardScope(NOBODY, {
    scoped: true,
    branchIds: null,
    gradeIds: null,
    divisions: [],
    unassigned: false,
  });
  assert(
    'a head with an unbounded assignment narrows nothing',
    runsEverything.gradeIds === null,
  );

  return failed;
}

async function main(): Promise<void> {
  console.log('\nThe exam fold — no database:');
  const foldFailures = checkFold();

  console.log('\nThe dashboard scope — no database:');
  const scopeFailures = await checkScopeShortCircuits();

  console.log('\nAggregates against the real schema:');
  loadDatabaseUrl();

  let failed = 0;

  for (const [name, run] of CHECKS) {
    try {
      const started = Date.now();
      const result = await run();
      const shape = Array.isArray(result)
        ? `${result.length} row(s)`
        : result === null
          ? 'null'
          : typeof result === 'object'
            ? Object.keys(result as object).join(', ')
            : String(result);
      console.log(`  ok   ${name.padEnd(32)} ${String(Date.now() - started).padStart(5)}ms  ${shape}`);
    } catch (caught) {
      failed += 1;
      console.log(`  FAIL ${name}`);
      console.log(`       ${caught instanceof Error ? caught.message : String(caught)}`);
    }
  }

  const pureFailures = foldFailures + scopeFailures;

  if (failed > 0) {
    console.log(`\nFAIL — ${failed} of ${CHECKS.length} aggregates could not execute.`);
  } else if (pureFailures > 0) {
    console.log(
      `\nFAIL — every aggregate executed, but ${pureFailures} assertion(s) about the exam fold or the dashboard scope did not hold.`,
    );
  } else {
    console.log(
      `\nPASS — ${CHECKS.length} aggregates executed against the real schema, and the exam fold and dashboard scope both hold.`,
    );
  }

  process.exitCode = failed + pureFailures === 0 ? 0 : 1;
}

void main();
