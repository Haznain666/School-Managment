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
  getAttendanceByClass,
  getAttendanceTrend,
  getClassStrength,
  getCollectionTrend,
  getExamPerformance,
  getFeeStatusSplit,
  getRecentExamOutcomes,
  getTodaySnapshot,
  distribute,
  foldStudentTotals,
  readExamMarks,
  type FoldableResult,
} from '../lib/dashboard-queries';
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

async function main(): Promise<void> {
  console.log('\nThe exam fold — no database:');
  const foldFailures = checkFold();

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
      console.log(`  ok   ${name.padEnd(22)} ${String(Date.now() - started).padStart(5)}ms  ${shape}`);
    } catch (caught) {
      failed += 1;
      console.log(`  FAIL ${name}`);
      console.log(`       ${caught instanceof Error ? caught.message : String(caught)}`);
    }
  }

  if (failed > 0) {
    console.log(`\nFAIL — ${failed} of ${CHECKS.length} aggregates could not execute.`);
  } else if (foldFailures > 0) {
    console.log(
      `\nFAIL — every aggregate executed, but ${foldFailures} assertion(s) about the exam fold did not hold.`,
    );
  } else {
    console.log(
      `\nPASS — ${CHECKS.length} aggregates executed against the real schema, and the exam fold holds.`,
    );
  }

  process.exitCode = failed + foldFailures === 0 ? 0 : 1;
}

void main();
