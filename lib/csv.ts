/**
 * A CSV reader, because there is no CSV dependency and adding one is not free.
 *
 * `SPRINTS.md` §0.1 pins the dependency list, and the import is the only thing
 * in the plan that needs to read a delimited file. So this is RFC 4180 by hand:
 * quoted fields, embedded delimiters and newlines, `""` as an escaped quote,
 * CRLF or LF, and a UTF-8 BOM stripped because Excel writes one on every
 * "Save as CSV" and it otherwise becomes part of the first column's name — the
 * kind of defect that presents as "the mapping screen shows a blank column".
 *
 * **Tab-separated files are read too**, sniffed from the header line rather
 * than asked about. A school exporting from their old system produces whatever
 * that system produced, and being told "this is not a CSV" about a file that
 * plainly is a table is the first thing that makes an importer feel hostile.
 *
 * Dependency-free and pure: no `server-only`, so the mapping screen can preview
 * a file in the browser using exactly the parser the commit will use. Two
 * parsers disagreeing about where the columns are is the failure mode this
 * avoids.
 *
 * Not handled, deliberately: `.xlsx`. It is a zip of XML and needs a real
 * library. The upload screen says so and points at "Save as CSV", which every
 * spreadsheet has.
 */

/** What a delimited file turns into. */
export interface ParsedCsv {
  /** The header row, trimmed, in file order. Duplicates are disambiguated. */
  columns: string[];
  /**
   * Data rows keyed by column name.
   *
   * Keyed rather than positional because everything downstream — the column
   * map, the validation report, the stored `raw` — refers to columns by the
   * name the operator saw on the mapping screen.
   */
  rows: Array<Record<string, string>>;
  /** The delimiter that was sniffed, for reporting back. */
  delimiter: ',' | '\t' | ';';
}

export class CsvError extends Error {}

/** Most rows a single upload may carry. */
export const MAX_CSV_ROWS = 2000;

const DELIMITERS = [',', '\t', ';'] as const;

/**
 * Picks the delimiter by counting candidates outside quotes on the first line.
 *
 * Counting outside quotes matters: `"Khan, Ayesha",Grade 6` has two commas and
 * one of them is part of a name. A naive count would still pick the comma here,
 * but on a semicolon file with comma-containing names it would pick wrong.
 */
function sniffDelimiter(text: string): ',' | '\t' | ';' {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';

  let best: ',' | '\t' | ';' = ',';
  let bestCount = 0;

  for (const candidate of DELIMITERS) {
    let count = 0;
    let inQuotes = false;

    for (let index = 0; index < firstLine.length; index += 1) {
      const char = firstLine[index];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === candidate && !inQuotes) {
        count += 1;
      }
    }

    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }

  return best;
}

/** Splits the whole text into rows of raw string cells. */
function splitCells(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let index = 0;

  const endCell = () => {
    row.push(cell);
    cell = '';
  };

  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
  };

  while (index < text.length) {
    const char = text[index]!;

    if (inQuotes) {
      if (char === '"') {
        // `""` inside a quoted field is one literal quote.
        if (text[index + 1] === '"') {
          cell += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }
      cell += char;
      index += 1;
      continue;
    }

    if (char === '"' && cell === '') {
      inQuotes = true;
      index += 1;
      continue;
    }

    if (char === delimiter) {
      endCell();
      index += 1;
      continue;
    }

    if (char === '\r') {
      // CRLF and a lone CR both end the row.
      endRow();
      index += text[index + 1] === '\n' ? 2 : 1;
      continue;
    }

    if (char === '\n') {
      endRow();
      index += 1;
      continue;
    }

    cell += char;
    index += 1;
  }

  // A file that does not end in a newline still has a last row; one that does
  // must not gain an empty one.
  if (cell !== '' || row.length > 0) endRow();

  return rows;
}

/**
 * Makes the header usable as a set of keys.
 *
 * Blank headers become `Column 3` rather than being dropped: a spreadsheet
 * with an unlabelled column still has data in it, and silently discarding a
 * column is how a phone number goes missing without anybody being told.
 * Duplicates get a suffix for the same reason — two columns both called
 * "Name" is common, and collapsing them loses one.
 */
function normaliseColumns(header: readonly string[]): string[] {
  const seen = new Map<string, number>();

  return header.map((raw, position) => {
    const trimmed = raw.trim();
    const base = trimmed === '' ? `Column ${position + 1}` : trimmed;

    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);

    return count === 0 ? base : `${base} (${count + 1})`;
  });
}

/**
 * Parses a delimited file.
 *
 * Rows shorter than the header are padded and rows longer are truncated, both
 * silently. A ragged file is normal — trailing empty cells are how most
 * exporters write a blank last column — and refusing the file over it would
 * block an import for a reason the operator cannot see or fix.
 */
export function parseCsv(text: string): ParsedCsv {
  // Excel writes a BOM on every "Save as CSV". Left in place it becomes part of
  // the first column's name and that column silently fails to map.
  const cleaned = text.replace(/^﻿/, '');

  if (cleaned.trim() === '') {
    throw new CsvError('That file is empty.');
  }

  const delimiter = sniffDelimiter(cleaned);
  const cells = splitCells(cleaned, delimiter);

  // Wholly blank lines carry nothing and appear at the end of most exports.
  const meaningful = cells.filter((row) => row.some((value) => value.trim() !== ''));

  const headerRow = meaningful[0];
  if (headerRow === undefined) {
    throw new CsvError('That file has no header row.');
  }

  const columns = normaliseColumns(headerRow);

  const dataRows = meaningful.slice(1);
  if (dataRows.length > MAX_CSV_ROWS) {
    throw new CsvError(
      `That file has ${dataRows.length} rows. Import at most ${MAX_CSV_ROWS} at a time — ` +
        'split it by class and import each part.',
    );
  }

  const rows = dataRows.map((row) => {
    const record: Record<string, string> = {};
    for (let index = 0; index < columns.length; index += 1) {
      record[columns[index]!] = (row[index] ?? '').trim();
    }
    return record;
  });

  return { columns, rows, delimiter };
}
