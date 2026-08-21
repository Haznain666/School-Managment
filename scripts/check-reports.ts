/**
 * Executes every report against the real database, and asserts the CSV writer
 * without one.
 *
 *     npm run check-reports
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * The same reason `scripts/check-dashboard-queries.ts` does, and more sharply.
 * These sixteen queries carry hand-written SQL — `filter (where …)`,
 * `case when … end`, `to_char`, `extract(isodow …)`, a correlated subquery —
 * and TypeScript checks none of it. A typo inside a `sql` template compiles
 * perfectly and fails at the first request, which here means the report an
 * accountant opened to answer a board. Nothing else in this repo would catch
 * it before a browser did, and the portals still cannot be signed into from a
 * development machine (STATE.md §5d).
 *
 * ── It earned its keep on 2026-08-21 ─────────────────────────────────────
 * Sprint 13.5's day book threw `column reference "id" is ambiguous` on every
 * call, and this is the only check in the repository that would ever have said
 * so. **Drizzle renders a column interpolated into a `sql` template unqualified
 * when the outer query has a single table in its FROM**, and qualifies it once
 * a join is present — so a correlated sub-select that is correct beside a join
 * is ambiguous, or silently false, without one. Neither the type-checker, the
 * build, nor the credential-free `check-accounting` can see any of that.
 * Run this after touching any runner.
 *
 * Each runner is called once with a location id that matches no school. Every
 * report returns empty, no real school's data is read, and the SQL still has to
 * parse, resolve every column and execute.
 *
 * ── And the part SQL cannot check ────────────────────────────────────────
 * The CSV writer is asserted first, with no database at all. Its two
 * non-obvious behaviours — the Excel BOM and the formula-injection guard —
 * both look like bugs to anyone inspecting the file, so they are the two most
 * likely to be "cleaned up" by a later change. A test is the only thing that
 * says they were deliberate.
 */

import { readFileSync } from 'node:fs';

import { csvCell, csvFilename, toCsv, UTF8_BOM, csvBody } from '../lib/csv-export';
import {
  defaultDateRange,
  parseReportParams,
  rate,
  reportFor,
  REPORT_KEYS,
  reportsFor,
  toReportQuery,
} from '../lib/report-catalogue';
import { runReport } from '../lib/report-queries';

/** A syntactically valid id that belongs to no tenant. */
const NOBODY = '00000000-0000-0000-0000-000000000000';

/** A term id that matches no term — the results report short-circuits without one. */
const NO_TERM = '00000000-0000-0000-0000-000000000003';

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

/* -----------------------------------------------------------------------------
 * The pure half, asserted without a database.
 * -------------------------------------------------------------------------- */

function checkPure(): number {
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

  // ── The writer ────────────────────────────────────────────────────────
  assert('a plain cell is written bare', csvCell('Ayesha'), 'Ayesha');
  assert('a comma forces quotes', csvCell('Khan, Ayesha'), '"Khan, Ayesha"');
  assert('a quote is doubled inside quotes', csvCell('5" pipe'), '"5"" pipe"');
  assert('a newline forces quotes', csvCell('a\nb'), '"a\nb"');
  assert('numbers are written bare, so a spreadsheet can sum them', csvCell(12500.5), '12500.5');
  assert('null is an empty cell, not the word null', csvCell(null), '');
  assert('a non-finite number is empty rather than NaN', csvCell(Number.NaN), '');

  // The whole reason `FORMULA_STARTERS` exists. A name field is user input and
  // reaches every export the office opens.
  assert(
    'a leading = is neutralised',
    csvCell('=HYPERLINK("http://x")'),
    `"'=HYPERLINK(""http://x"")"`,
  );
  assert('a leading + is neutralised', csvCell('+1'), "'+1");
  assert('a leading - is neutralised', csvCell('-1+1'), "'-1+1");
  assert('a leading @ is neutralised', csvCell('@SUM(A1)'), "'@SUM(A1)");
  assert('a negative *number* is still a number', csvCell(-1), '-1');

  const columns = [
    { key: 'name', label: 'Name' },
    { key: 'owed', label: 'Owed' },
  ];

  assert(
    'header then rows, CRLF, trailing newline',
    toCsv(columns, [{ name: 'Ali', owed: 100 }]),
    'Name,Owed\r\nAli,100\r\n',
  );
  assert(
    'a missing key is an empty cell, not a hole in the row',
    toCsv(columns, [{ name: 'Ali' }]),
    'Name,Owed\r\nAli,\r\n',
  );
  assert('the body carries the Excel BOM', csvBody(columns, []).startsWith(UTF8_BOM), true);

  assert(
    'the filename is findable six months later',
    csvFilename('Fee collection', new Date('2026-08-15T09:00:00Z')),
    'fee-collection-2026-08-15.csv',
  );
  assert(
    'and cannot carry anything a header would choke on',
    csvFilename('A/B "school"', new Date('2026-08-15T09:00:00Z')),
    'a-b-school-2026-08-15.csv',
  );

  // ── Rates ─────────────────────────────────────────────────────────────
  assert('a rate is one decimal', rate(1, 3), 33.3);
  // Null, not zero: a class nobody marked has no attendance rate, and printing
  // 0% beside it says every child was absent.
  assert('nothing to divide by is null, never zero', rate(0, 0), null);

  // ── Parameters ────────────────────────────────────────────────────────
  const today = new Date('2026-08-15T00:00:00Z');
  const attendance = reportFor('attendance-summary');

  assert(
    'a missing range falls back to the default month',
    parseReportParams(attendance, {}, today),
    { ...defaultDateRange(today) },
  );
  assert(
    'a malformed date falls back rather than reaching Postgres',
    parseReportParams(attendance, { from: 'yesterday', to: '2026-08-10' }, today).from,
    defaultDateRange(today).from,
  );
  assert(
    'a backwards range is swapped, not refused',
    parseReportParams(attendance, { from: '2026-08-10', to: '2026-08-01' }, today),
    { from: '2026-08-01', to: '2026-08-10' },
  );

  // The two `year`s. `ay` exists precisely so these cannot collide.
  const payroll = reportFor('payroll-summary');
  const funnel = reportFor('enrollment-funnel');
  assert(
    'the payroll year is a calendar year',
    parseReportParams(payroll, { year: '2025' }, today).year,
    2025,
  );
  assert(
    'and never picks up an academic year id',
    parseReportParams(payroll, { year: '2025' }, today).academicYearId,
    undefined,
  );
  assert(
    'the funnel reads its academic year from `ay`',
    parseReportParams(funnel, { ay: 'abc' }, today).academicYearId,
    'abc',
  );

  assert(
    'round-tripping the filters is lossless',
    parseReportParams(
      attendance,
      Object.fromEntries(
        new URLSearchParams(
          toReportQuery({ from: '2026-07-01', to: '2026-07-31', gradeId: 'g1' }),
        ),
      ),
      today,
    ),
    { from: '2026-07-01', to: '2026-07-31', gradeId: 'g1' },
  );

  // ── The catalogue ─────────────────────────────────────────────────────
  // Nine from Sprint 12, seven financial statements from Sprint 13.5.
  assert('sixteen reports across the two sprints', REPORT_KEYS.length, 16);
  assert(
    'the seven financial statements are all declared',
    reportsFor(['accounting.read']).map((report) => report.key),
    [
      'balance-sheet',
      'profit-loss',
      'day-book',
      'account-summary',
      'monthly-accounts',
      'expense-detail',
      'income-expense-summary',
    ],
  );
  assert(
    'every report is answerable by a runner',
    REPORT_KEYS.every((key) => reportFor(key).columns.length > 0),
    true,
  );
  assert(
    'a role with no permissions is offered no reports',
    reportsFor([]).length,
    0,
  );
  assert(
    'an accountant is offered the money and nothing else',
    reportsFor(['fees.read', 'payroll.read']).map((report) => report.key),
    ['fee-collection', 'outstanding-aging', 'payroll-summary', 'monthly-revenue'],
  );

  return failed;
}

/* -----------------------------------------------------------------------------
 * Every runner, against the real schema.
 * -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  console.log('\nThe writer, the rates and the parameters — no database:\n');
  const pureFailures = checkPure();

  loadDatabaseUrl();
  console.log('\nEvery report, against the real schema:\n');

  const scope = { locationId: NOBODY, sessionBranchId: null };
  let failed = pureFailures;

  for (const key of REPORT_KEYS) {
    const definition = reportFor(key);

    // The term is supplied so the results report runs its three reads rather
    // than short-circuiting — which would leave the one query that touches
    // `exam_results` as the one this script never executed.
    const params = parseReportParams(definition, {
      term: definition.filters.includes('term') ? NO_TERM : undefined,
    });

    try {
      const result = await runReport(key, scope, params);
      console.log(`  ok   ${key} (${result.rows.length} rows)`);
    } catch (error) {
      failed += 1;
      console.log(`  FAIL ${key}`);
      console.log(`       ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log('');

  if (failed > 0) {
    console.log(`${failed} check(s) failed.`);
    process.exitCode = 1;
    return;
  }

  console.log('All checks passed.');
}

await main();

// postgres-js keeps a pooled socket open, which holds the process alive. The
// dashboard check ends the same way and for the same reason; `process.exit()`
// with sockets open aborts on Windows (§5u).
process.exit(process.exitCode ?? 0);
