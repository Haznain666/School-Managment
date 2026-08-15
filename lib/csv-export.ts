/**
 * A CSV writer, for the same reason `lib/csv.ts` is a CSV reader: there is no
 * CSV dependency and `SPRINTS.md` §0.1 pins the dependency list. `lib/csv.ts`
 * only reads; nothing in the repo could produce a file until now.
 *
 * Deliberately dependency-free and free of `server-only`, so
 * `scripts/check-reports.ts` can assert it without a database and without a
 * Next.js runtime. The only thing it needs from the platform is `Response`,
 * which is a web standard and is what `SPRINTS.md` §Sprint 12 specifies for the
 * export ("native `Response` with `text/csv`").
 *
 * ── Two things this does that a naive `rows.join(',')` does not ──────────
 *
 * **1. It writes a UTF-8 BOM.** Excel on Windows — which is what a Pakistani
 * school office runs — reads a BOM-less UTF-8 CSV in the system ANSI codepage.
 * A student called "Ayesha Khān" becomes "Ayesha KhÄn" and a school concludes
 * the export is broken. `lib/csv.ts` strips the BOM on the way in for the same
 * reason it is written here on the way out.
 *
 * **2. It neutralises formula injection.** A cell beginning `=`, `+`, `-`, `@`,
 * a tab or a carriage return is executed as a formula by Excel and LibreOffice
 * when the file is opened. Our own columns are numbers and names, but a name,
 * a guardian's note and a challan reference all reach a report from user input,
 * and `=HYPERLINK("http://…"&A1)` typed into a student's name field would
 * otherwise become a live exfiltration link in every export the office opens.
 * The guard is a leading apostrophe, which is what the spreadsheet itself uses
 * to mean "this is text" — the value still reads correctly in the cell.
 *
 * Both are worth stating because both look like bugs to anybody who inspects
 * the raw file: the BOM shows up as `ï»¿` in a hex-blind editor, and the
 * apostrophe as a stray character.
 */

/** What a CSV cell may hold before it is rendered. */
export type CsvValue = string | number | null | undefined;

/** A column, keyed the same way the report rows are. */
export interface CsvColumn {
  key: string;
  label: string;
}

/** Characters a spreadsheet treats as the start of a formula. */
const FORMULA_STARTERS = ['=', '+', '-', '@', '\t', '\r'];

/**
 * One cell, quoted and escaped per RFC 4180.
 *
 * Numbers are written bare so a spreadsheet reads them as numbers; a
 * pre-formatted `12,500` would otherwise arrive as text and refuse to sum,
 * which is the first thing an accountant does to a fee report. That is why the
 * report rows carry raw numbers and the *screen* does the formatting — see
 * `lib/report-catalogue.ts`.
 */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';

  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '';
  }

  // The guard goes on before quoting, so the apostrophe lands inside the quotes
  // and is part of the cell's text rather than part of its syntax.
  const guarded = FORMULA_STARTERS.some((char) => value.startsWith(char))
    ? `'${value}`
    : value;

  if (/[",\r\n]/.test(guarded)) {
    return `"${guarded.replaceAll('"', '""')}"`;
  }

  return guarded;
}

/**
 * A whole file: header row, then one line per row.
 *
 * CRLF line endings, which is what RFC 4180 specifies and what Excel expects.
 * Every reader that matters accepts both, but only one of them is the standard.
 */
export function toCsv(
  columns: readonly CsvColumn[],
  rows: ReadonlyArray<Record<string, CsvValue>>,
): string {
  const lines: string[] = [columns.map((column) => csvCell(column.label)).join(',')];

  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(row[column.key])).join(','));
  }

  // A trailing newline: a file whose last line has no terminator makes some
  // tools drop the last row, and the empty final line is ignored by all of them.
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * A filename a school can find again in a Downloads folder six months later.
 *
 * `fee-collection-2026-08-15.csv`, not `export.csv`. Anything outside
 * `[a-z0-9-]` is collapsed, because a filename reaches a `Content-Disposition`
 * header and a header cannot carry a quote or a newline — a school name is
 * user input and this is where it would land.
 */
export function csvFilename(stem: string, on: Date = new Date()): string {
  const slug = stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const day = on.toISOString().slice(0, 10);

  return `${slug === '' ? 'report' : slug}-${day}.csv`;
}

/** The BOM Excel needs to read the file as UTF-8. See the docblock. */
export const UTF8_BOM = '﻿';

/** The whole downloadable body, BOM included. */
export function csvBody(
  columns: readonly CsvColumn[],
  rows: ReadonlyArray<Record<string, CsvValue>>,
): string {
  return `${UTF8_BOM}${toCsv(columns, rows)}`;
}

/**
 * The response headers a CSV download needs.
 *
 * Headers rather than a whole `Response`, because the route that uses them
 * returns a `NextResponse` — and `no-store` is not decoration: a report is a
 * snapshot of live data, and a cached one handed to the next person to press
 * Export would be last week's numbers under today's filename.
 */
export function csvHeaders(filename: string): Record<string, string> {
  return {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="${filename}"`,
    'cache-control': 'no-store',
  };
}
