import { csvBody, csvHeaders, type CsvColumn } from '@/lib/csv-export';
import { IMPORT_FIELDS } from '@/lib/student-import';

/**
 * The sample sheet a school downloads before it imports anybody.
 *
 * ── What this is for ─────────────────────────────────────────────────────
 * The mapping screen explains the fields *after* a file has been uploaded,
 * which is the wrong way round for the person who has not built the file yet.
 * They are looking at their old system's export, or at an empty spreadsheet,
 * and the only question they have is "what do you want in it". Before this
 * existed the answer was on a screen they could only reach by first producing
 * the thing they were asking about.
 *
 * So the sample is a real file: the header row the importer recognises, and
 * three rows showing what each column may hold. Delete the three rows, paste a
 * roll in underneath the header, upload — and the mapping screen comes back
 * with every column already matched, because the headers *are* the aliases.
 *
 * ── The rule that keeps it honest ────────────────────────────────────────
 * A sample sheet is a promise about what the importer accepts, and a promise
 * that has drifted from the code is worse than no sample at all: the operator
 * builds four hundred rows against it and discovers on upload that the column
 * it taught them is not a column any more. Two things therefore hold, and both
 * are asserted by `npm run check-import-sample`:
 *
 *   1. **Every field in `IMPORT_FIELDS` has a column here, and nothing else
 *      does.** Adding an importable field without adding it to the sample
 *      fails the build rather than shipping a sample that omits it.
 *   2. **The sample round-trips.** Its own body, read back through
 *      `parseCsv` and `suggestColumnMap`, maps every field to its own column,
 *      and `validateRow` accepts all three rows with no errors. That is the
 *      whole promise, checked the way the product will check it.
 *
 * ── Why the headers are the aliases ──────────────────────────────────────
 * `suggestColumnMap` guesses from header text. Choosing the sample's headers
 * from the alias lists means a file built on the sample needs no mapping at
 * all — the operator confirms rather than assembles. It also means the two
 * lists cannot drift apart unnoticed, because rule 2 above stops being true
 * the moment an alias is renamed.
 *
 * Dependency-free and free of `server-only`, like the two modules it sits
 * between, so the check script can assert it without a Next.js runtime.
 */

/** One column of the sample: its header, and what the three rows hold. */
interface SampleColumn {
  /**
   * The header written into the file.
   *
   * Chosen from the field's own `aliases` so `suggestColumnMap` matches it
   * exactly, rather than falling through to the substring pass where two
   * fields can compete for one header.
   */
  header: string;
  /** Three values, one per sample row. A blank shows the field is optional. */
  values: readonly [string, string, string];
}

/**
 * The sample, keyed by import field.
 *
 * The three rows are not three copies of the same row. Each one is carrying an
 * argument:
 *
 *   Row 1 — everything filled in, in the tidiest form. The shape to copy.
 *   Row 2 — a different date format, `M`/`F` instead of the words, spaces in
 *           the phone number, and two blanks. All accepted.
 *   Row 3 — no admission number, so the school issues one; a `+92` phone; and
 *           a guardian who is neither parent.
 *
 * A sample where every row is identical teaches that the tidy form is the
 * *only* form, and an office with a messy export then reformats four hundred
 * rows by hand before uploading a file that would have been read as it stood.
 */
const SAMPLE_COLUMNS: Record<string, SampleColumn> = {
  name: {
    header: 'Student name',
    values: ['Ayesha Khan', 'Bilal Ahmed', 'Fatima Noor'],
  },
  admissionNumber: {
    header: 'Admission number',
    // Blank on row 3: the school issues a number when the column is empty.
    values: ['2024-0413', '2024-0414', ''],
  },
  dateOfBirth: {
    header: 'Date of birth',
    // Three spellings of a date, all read. `14/07/2016` and `2-11-2017` are
    // day-first, which is how a Pakistani office writes one.
    values: ['2015-03-09', '14/07/2016', '2-11-2017'],
  },
  gender: {
    header: 'Gender',
    values: ['female', 'M', 'F'],
  },
  rollNumber: {
    header: 'Roll number',
    values: ['12', '7', ''],
  },
  bFormCnic: {
    header: 'B-Form / CNIC',
    values: ['42101-1234567-1', '', ''],
  },
  guardianName: {
    header: 'Guardian name',
    values: ['Imran Khan', 'Sadia Ahmed', 'Noor ul Hassan'],
  },
  guardianPhone: {
    header: 'Guardian phone',
    // Spaces and a country code both survive. The third is written `+92…`,
    // which `lib/csv-export.ts` guards with a leading apostrophe so a
    // spreadsheet does not read it as a formula — see that module's docblock.
    values: ['03001234567', '0321 987 6543', '+92 333 4567890'],
  },
  guardianEmail: {
    header: 'Guardian email',
    values: ['imran.khan@example.com', '', ''],
  },
  guardianRelationship: {
    header: 'Relationship',
    values: ['father', 'mother', 'guardian'],
  },
};

/** How many example rows the sample carries. */
export const SAMPLE_ROW_COUNT = 3;

/**
 * The sample's columns, in the order `IMPORT_FIELDS` declares them.
 *
 * Driven off `IMPORT_FIELDS` rather than off `SAMPLE_COLUMNS` so that a field
 * added to the importer and forgotten here throws at module load — in the
 * check, in the route, and in the test — instead of silently producing a
 * sample that is missing a column.
 */
export function sampleSheetColumns(): CsvColumn[] {
  return IMPORT_FIELDS.map((field) => {
    const column = SAMPLE_COLUMNS[field.key];
    if (column === undefined) {
      throw new Error(
        `The import field “${field.key}” has no column in the sample sheet. ` +
          'Add one to lib/student-import-sample.ts.',
      );
    }
    return { key: field.key, label: column.header };
  });
}

/** The three example rows, keyed the way `toCsv` wants them. */
export function sampleSheetRows(): Array<Record<string, string>> {
  const columns = sampleSheetColumns();

  return Array.from({ length: SAMPLE_ROW_COUNT }, (_unused, index) =>
    Object.fromEntries(
      columns.map((column) => [
        column.key,
        SAMPLE_COLUMNS[column.key]!.values[index] ?? '',
      ]),
    ),
  );
}

/** The whole file, BOM included, exactly as the download serves it. */
export function sampleSheetCsv(): string {
  return csvBody(sampleSheetColumns(), sampleSheetRows());
}

/**
 * The name it lands in a Downloads folder under.
 *
 * Undated, unlike an export. A report is a snapshot and its date is part of
 * what it is; a template is not, and stamping today's date on it invites the
 * question of whether last month's copy is still the right one.
 */
export const SAMPLE_SHEET_FILENAME = 'student-import-sample.csv';

/** The response headers the download needs. */
export function sampleSheetHeaders(): Record<string, string> {
  return csvHeaders(SAMPLE_SHEET_FILENAME);
}
