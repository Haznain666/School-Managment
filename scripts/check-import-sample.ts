/**
 * The student-import sample sheet, asserted rather than trusted — Sprint 31.
 *
 * ── Why a script and not a look at the file ──────────────────────────────
 * A sample sheet is a *promise*: these are the columns, this is what may go in
 * them, and a file built like this will import. Nothing in the repository
 * makes that promise true. A field renamed in `IMPORT_FIELDS`, an alias list
 * tidied, a validation rule tightened — each of those leaves the sample
 * compiling, type-checking and downloading exactly as before, and each of them
 * turns it into a lie that is only discovered by the person who has already
 * built four hundred rows against it.
 *
 * The failure is also silent in the direction that matters most. If the
 * headings stop matching the aliases nothing breaks: the file still uploads,
 * the mapping screen still opens, and the only symptom is that the columns
 * arrive unmatched — which reads as "this product's guessing is poor", not as
 * "the sample is stale".
 *
 * So the promise is checked the way the product will check it: the sample's
 * own bytes are read back through `parseCsv`, mapped with `suggestColumnMap`
 * and validated with `validateRow` — the three functions the import itself
 * uses. Everything here is pure and needs no database, so it sits in CI beside
 * `check-loaders` and `check-cnic`.
 *
 *   npm run check-import-sample
 *
 * Exit code 1 on any violation.
 */

import { readFileSync } from 'node:fs';

import { parseCsv } from '../lib/csv';
import { UTF8_BOM } from '../lib/csv-export';
import {
  IMPORT_FIELDS,
  findDuplicateAdmissionNumbers,
  suggestColumnMap,
  validateRow,
} from '../lib/student-import';
import {
  SAMPLE_ROW_COUNT,
  SAMPLE_SHEET_FILENAME,
  sampleSheetColumns,
  sampleSheetCsv,
  sampleSheetRows,
} from '../lib/student-import-sample';

let failures = 0;
let checks = 0;

function ok(condition: boolean, description: string): void {
  checks += 1;
  if (condition) {
    console.log(`  ✓ ${description}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${description}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

/* --------------------------------------------------------------------------
 * 1. The sample covers the importer, and nothing else.
 * -------------------------------------------------------------------------- */

section('The columns match the importable fields');

const columns = sampleSheetColumns();

ok(
  columns.length === IMPORT_FIELDS.length,
  `one column per importable field (${String(columns.length)} of ${String(IMPORT_FIELDS.length)})`,
);

ok(
  columns.every((column, index) => column.key === IMPORT_FIELDS[index]!.key),
  'in the order the mapping screen lists them, so the sheet reads left to right the way the screen reads top to bottom',
);

const headings = columns.map((column) => column.label);

ok(
  new Set(headings.map((heading) => heading.toLowerCase())).size === headings.length,
  'no two columns share a heading — two columns called the same thing is a mapping the operator cannot resolve',
);

ok(
  columns.every((column) => {
    const field = IMPORT_FIELDS.find((candidate) => candidate.key === column.key)!;
    return field.aliases.includes(column.label.trim().toLowerCase());
  }),
  'every heading is one of its own field’s aliases, so the exact-match pass claims it rather than the substring pass, where two fields can compete for one heading',
);

/* --------------------------------------------------------------------------
 * 2. The file is a file: BOM, header row, three rows.
 * -------------------------------------------------------------------------- */

section('The downloaded body');

const body = sampleSheetCsv();

ok(
  body.startsWith(UTF8_BOM),
  'starts with the UTF-8 BOM, without which Excel on Windows reads it in the system codepage and a school sees their own names spelled wrong',
);

ok(
  SAMPLE_SHEET_FILENAME.endsWith('.csv') && !/\d{4}-\d{2}-\d{2}/.test(SAMPLE_SHEET_FILENAME),
  `saves as ${SAMPLE_SHEET_FILENAME} — undated, because a template is not a snapshot`,
);

const parsed = parseCsv(body);

ok(parsed.delimiter === ',', 'reads back as a comma-separated file');

ok(
  parsed.columns.length === headings.length &&
    parsed.columns.every((column, index) => column === headings[index]),
  'the header row survives the round trip intact, BOM stripped and nothing renamed',
);

ok(
  parsed.rows.length === SAMPLE_ROW_COUNT,
  `carries ${String(SAMPLE_ROW_COUNT)} example rows (found ${String(parsed.rows.length)})`,
);

ok(
  sampleSheetRows().length === SAMPLE_ROW_COUNT,
  'and the row builder and the written file agree on how many there are',
);

/* --------------------------------------------------------------------------
 * 3. The whole promise: a file built on this needs no mapping and imports.
 * -------------------------------------------------------------------------- */

section('A file built on the sample maps itself');

const suggested = suggestColumnMap(parsed.columns);

ok(
  IMPORT_FIELDS.every((field) => suggested[field.key] !== undefined),
  'every field — optional ones included — is matched by the importer’s own guesser',
);

const misrouted = IMPORT_FIELDS.filter((field) => {
  const expected = columns.find((column) => column.key === field.key)!.label;
  return suggested[field.key] !== expected;
});

for (const field of misrouted) {
  const expected = columns.find((column) => column.key === field.key)!.label;
  console.log(
    `      ${field.key}: expected “${expected}”, guessed “${String(suggested[field.key])}”`,
  );
}

ok(
  misrouted.length === 0,
  'and matches each one to its own column — a bijection, so the operator confirms the mapping instead of assembling it',
);

section('Every example row imports');

const problems: string[] = [];

for (const [index, row] of parsed.rows.entries()) {
  const { candidate, errors } = validateRow(row, suggested);
  if (candidate === null || errors.length > 0) {
    problems.push(`row ${String(index + 2)}: ${errors.join(' ') || 'no candidate produced'}`);
  }
}

for (const problem of problems) console.log(`      ${problem}`);

ok(
  problems.length === 0,
  'all of them pass `validateRow` with no errors — a sample the product itself rejects is the worst thing this file could ship',
);

const candidates = parsed.rows.map((row) => validateRow(row, suggested).candidate);

ok(
  findDuplicateAdmissionNumbers(
    candidates.map((candidate, index) => ({
      rowNumber: index + 2,
      admissionNumber: candidate?.admissionNumber ?? null,
    })),
  ).size === 0,
  'and no two of them collide on an admission number',
);

/* --------------------------------------------------------------------------
 * 4. The rows are each carrying their argument.
 * -------------------------------------------------------------------------- */

section('The rows teach what they were written to teach');

ok(
  candidates.map((candidate) => candidate?.dateOfBirth).join(' ') ===
    '2015-03-09 2016-07-14 2017-11-02',
  'three spellings of a date all land on the date meant — including the two written day-first, which is how a Pakistani office writes one',
);

ok(
  candidates.map((candidate) => candidate?.gender).join(' ') === 'female male female',
  '`M` and `F` are read as the words, so an export that uses initials needs no editing first',
);

ok(
  candidates.every((candidate) => /^\+923\d{9}$/.test(candidate?.guardianPhone ?? '')),
  'all three phone numbers normalise to E.164 — spaces, a leading 0 and a +92 country code are each accepted',
);

ok(
  (parsed.rows[2]?.['Guardian phone'] ?? '').startsWith("'+"),
  'the +92 number carries the spreadsheet formula guard from `lib/csv-export.ts`, and `normaliseImportPhone` reads straight through it',
);

ok(
  candidates.filter((candidate) => candidate?.admissionNumber === null).length === 1,
  'one row leaves the admission number blank, which is how the school is shown that it will issue one',
);

ok(
  candidates.some((candidate) => candidate?.guardianEmail === null) &&
    candidates.some((candidate) => candidate?.guardianEmail !== null),
  'the optional columns appear both filled in and empty, rather than implying everything is needed',
);

ok(
  new Set(candidates.map((candidate) => candidate?.guardianRelationship)).size === 3,
  'and the guardian is a father on one row, a mother on another and neither on the third',
);

/* --------------------------------------------------------------------------
 * 5. It is reachable. A generated file nothing links to is not a feature.
 * -------------------------------------------------------------------------- */

section('The download exists and the screen offers it');

const ROUTE = 'app/api/school/student-imports/sample/route.ts';
const SCREEN = 'components/admissions/StudentImporter.tsx';

const routeSource = readFileSync(ROUTE, 'utf8');

ok(
  routeSource.includes('sampleSheetCsv()'),
  `${ROUTE} serves the generated body rather than a second copy of the column list`,
);

ok(
  routeSource.includes("permission: 'students.import'"),
  'and is gated on students.import, the same permission the importer itself needs',
);

const screenSource = readFileSync(SCREEN, 'utf8');

ok(
  screenSource.includes('href="/api/school/student-imports/sample"'),
  `${SCREEN} links to it — Sprint 27 shipped a complete route no screen called, and a green build cannot see that`,
);

ok(
  screenSource.includes('download={SAMPLE_SHEET_FILENAME}'),
  'with a download attribute naming the file, so it does not land in a Downloads folder as “sample”',
);

/* -------------------------------------------------------------------------- */

console.log(
  failures === 0
    ? `\nPASS — ${String(checks)} assertions across the sample sheet, its round trip through the importer, and its route.`
    : `\nFAIL — ${String(failures)} of ${String(checks)} assertions failed.`,
);

process.exitCode = failures === 0 ? 0 : 1;
