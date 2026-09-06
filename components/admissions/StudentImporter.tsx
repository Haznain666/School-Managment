'use client';

import { useCallback, useMemo, useState } from 'react';

import { Download } from 'lucide-react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Select } from '@/components/ui/Select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@/components/ui/Table';
import { CsvError, MAX_CSV_ROWS, parseCsv } from '@/lib/csv';
import { IMPORT_FIELDS, suggestColumnMap, validateRow } from '@/lib/student-import';
import {
  SAMPLE_ROW_COUNT,
  SAMPLE_SHEET_FILENAME,
  sampleSheetColumns,
} from '@/lib/student-import-sample';

export interface SectionOption {
  id: string;
  label: string;
}

export interface StudentImporterProps {
  sections: readonly SectionOption[];
}

type Step = 'choose' | 'map' | 'report' | 'done';

interface RowReport {
  id: string;
  rowNumber: number;
  raw: Record<string, string>;
  outcome: string;
  errors: string[];
}

interface Counts {
  pending: number;
  invalid: number;
  created: number;
  skipped: number;
  failed: number;
}

/**
 * The sample sheet's columns, paired with the field each one feeds.
 *
 * Module-level and derived from `sampleSheetColumns()`, so the headings this
 * screen prints are the headings the downloaded file actually carries — the
 * one thing a table describing a file must not get wrong. `IMPORT_FIELDS`
 * supplies the rest, so the required marks and the descriptions are the same
 * text the mapping screen shows for the same field.
 */
const SAMPLE_SHEET_COLUMNS = sampleSheetColumns().map((column) => ({
  header: column.label,
  field: IMPORT_FIELDS.find((field) => field.key === column.key)!,
}));

const OUTCOME_LABELS: Record<string, string> = {
  pending: 'Will be imported',
  invalid: 'Needs fixing',
  created: 'Imported',
  skipped: 'Already here',
  failed: 'Could not be saved',
};

/**
 * Bulk student import: choose a file, map its columns, read the report, commit.
 *
 * ── Why the browser parses the file too ──────────────────────────────────
 * The preview and the mapping guess are computed here with `lib/csv.ts` and
 * `lib/student-import.ts` — the same modules the server uses. They are
 * dependency-free precisely so this is possible. The operator sees their own
 * columns and a sample of their own rows before anything is uploaded, which is
 * the difference between mapping columns and guessing at them.
 *
 * ── The report is the server's, not this component's ─────────────────────
 * The counts and the row-by-row verdicts shown at step three come from the dry
 * run stored against the batch. This component could compute a version of them
 * locally, and deliberately does not: the number the operator reads before
 * pressing Import must be the number the import acts on. The two would drift
 * the first time a rule needed the database — as the duplicate check does.
 */
export function StudentImporter({ sections }: StudentImporterProps) {
  const [step, setStep] = useState<Step>('choose');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [fileName, setFileName] = useState('');
  const [columns, setColumns] = useState<string[]>([]);
  const [preview, setPreview] = useState<Array<Record<string, string>>>([]);
  const [rowCount, setRowCount] = useState(0);

  const [batchId, setBatchId] = useState<string | null>(null);
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});
  const [sectionId, setSectionId] = useState('');

  const [counts, setCounts] = useState<Counts | null>(null);
  const [rows, setRows] = useState<RowReport[]>([]);
  const [shown, setShown] = useState<string>('invalid');

  const readFile = useCallback(async (file: File) => {
    setError(null);
    setBusy(true);

    try {
      const text = await file.text();
      const parsed = parseCsv(text);

      setFileName(file.name);
      setColumns(parsed.columns);
      setPreview(parsed.rows.slice(0, 5));
      setRowCount(parsed.rows.length);
      setColumnMap(suggestColumnMap(parsed.columns));

      const response = await fetch('/api/school/student-imports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, content: text }),
      });

      const payload = (await response.json()) as {
        ok: boolean;
        data?: { batchId: string; suggestedMap: Record<string, string> };
        error?: { message: string };
      };

      if (!response.ok || payload.ok !== true || payload.data === undefined) {
        setError(payload.error?.message ?? 'Could not read that file.');
        return;
      }

      setBatchId(payload.data.batchId);
      // The server's suggestion wins. It is the same function, but if the two
      // ever differ the one that matters is the one the validation will use.
      setColumnMap(payload.data.suggestedMap);
      setStep('map');
    } catch (caught) {
      setError(caught instanceof CsvError ? caught.message : 'Could not read that file.');
    } finally {
      setBusy(false);
    }
  }, []);

  const loadReport = useCallback(
    async (id: string, outcome: string) => {
      const query = outcome === 'all' ? '' : `?outcome=${outcome}`;
      const response = await fetch(`/api/school/student-imports/${id}${query}`);
      const payload = (await response.json()) as {
        ok: boolean;
        data?: { counts: Counts; rows: RowReport[] };
      };

      if (payload.ok === true && payload.data !== undefined) {
        setCounts(payload.data.counts);
        setRows(payload.data.rows);
      }
    },
    [],
  );

  const validate = useCallback(async () => {
    if (batchId === null) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/school/student-imports/${batchId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ columnMap, sectionId }),
      });

      const payload = (await response.json()) as {
        ok: boolean;
        data?: { counts: Counts };
        error?: { message: string };
      };

      if (!response.ok || payload.ok !== true || payload.data === undefined) {
        setError(payload.error?.message ?? 'Could not check that file.');
        return;
      }

      setCounts(payload.data.counts);
      const firstView = payload.data.counts.invalid > 0 ? 'invalid' : 'pending';
      setShown(firstView);
      await loadReport(batchId, firstView);
      setStep('report');
    } catch {
      setError('Could not check that file.');
    } finally {
      setBusy(false);
    }
  }, [batchId, columnMap, sectionId, loadReport]);

  const commit = useCallback(async () => {
    if (batchId === null) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/school/student-imports/${batchId}/commit`, {
        method: 'POST',
      });

      const payload = (await response.json()) as {
        ok: boolean;
        data?: { counts: Counts };
        error?: { message: string };
      };

      if (!response.ok || payload.ok !== true || payload.data === undefined) {
        setError(payload.error?.message ?? 'Could not import those students.');
        return;
      }

      setCounts(payload.data.counts);
      const firstView = payload.data.counts.failed > 0 ? 'failed' : 'created';
      setShown(firstView);
      await loadReport(batchId, firstView);
      setStep('done');
    } catch {
      setError('Could not import those students.');
    } finally {
      setBusy(false);
    }
  }, [batchId, loadReport]);

  /**
   * A local verdict on the sample rows, so the mapping screen reacts as the
   * operator changes a column rather than only after they press Check.
   *
   * Explicitly labelled as covering the sample only — this is a five-row
   * sanity check, not the report, and presenting it as the latter is how
   * somebody concludes their file is clean.
   */
  const previewProblems = useMemo(
    () =>
      preview
        .map((row, index) => ({ row: index + 2, errors: validateRow(row, columnMap).errors }))
        .filter((entry) => entry.errors.length > 0),
    [preview, columnMap],
  );

  const sectionOptions = [
    { value: '', label: 'Choose a class…' },
    ...sections.map((section) => ({ value: section.id, label: section.label })),
  ];

  const banner =
    error === null ? null : (
      <p role="alert" className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
        {error}
      </p>
    );

  if (step === 'choose') {
    return (
      <div className="space-y-4">
        {banner}
        <Card
          header={
            <CardTitle
              title="Choose a file"
              description={`A CSV with one student per row and a header row on top. Up to ${MAX_CSV_ROWS} students at a time.`}
            />
          }
        >
          <input
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
            disabled={busy}
            className="block w-full text-sm text-ink-muted file:mr-4 file:rounded-lg file:border-0 file:bg-brand-primary file:px-4 file:py-2 file:text-sm file:font-medium file:text-brand-onPrimary"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) void readFile(file);
            }}
          />

          <p className="mt-4 text-sm text-ink-muted">
            Exporting from Excel? Use <strong>Save as → CSV</strong>. An{' '}
            <code>.xlsx</code> file cannot be read directly. Tab-separated files
            work too.
          </p>
          <p className="mt-2 text-sm text-ink-muted">
            You will map your columns and see exactly what will happen before
            anything is saved.
          </p>
        </Card>

        <Card
          header={
            <CardTitle
              title="Not sure what the file should look like?"
              description={`Download the sample sheet, replace its ${String(SAMPLE_ROW_COUNT)} example rows with your own students, and upload it above.`}
            />
          }
        >
          {/*
            A plain anchor, not `Link`: this is an attachment, so there is no
            client-side navigation to make and nothing worth prefetching. The
            `download` attribute names the file rather than leaving the browser
            to derive one from the URL, which would save it as `sample`.
          */}
          <a
            href="/api/school/student-imports/sample"
            download={SAMPLE_SHEET_FILENAME}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-line-strong bg-surface-raised px-4 text-sm font-medium text-ink transition hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line-strong"
          >
            <Icon as={Download} size="sm" />
            Download the sample sheet
          </a>

          <p className="mt-4 text-sm text-ink-muted">
            Its headings are the ones we recognise, so a file built on it comes
            back with every column already matched. Your own headings work just
            as well — you match them by hand on the next screen.
          </p>

          <div className="mt-4 overflow-x-auto">
            <Table caption="The columns the sample sheet carries">
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Column</TableHeaderCell>
                  <TableHeaderCell>Needed?</TableHeaderCell>
                  <TableHeaderCell>What goes in it</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {SAMPLE_SHEET_COLUMNS.map((column) => (
                  <TableRow key={column.field.key}>
                    <TableCell className="font-medium">{column.header}</TableCell>
                    <TableCell>
                      {column.field.required ? (
                        <Badge variant="warning">Required</Badge>
                      ) : (
                        <Badge variant="neutral">Optional</Badge>
                      )}
                    </TableCell>
                    <TableCell muted>
                      {column.field.hint ?? column.field.label}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <p className="mt-4 text-sm text-ink-muted">
            Leave an optional column blank, or delete it altogether. Every
            student in one file joins one class, which you choose on the next
            screen — so the class is not a column.
          </p>
        </Card>
      </div>
    );
  }

  if (step === 'map') {
    return (
      <div className="space-y-4">
        {banner}

        <Card
          header={
            <CardTitle
              title="Match your columns"
              description={`${fileName} · ${rowCount} student${rowCount === 1 ? '' : 's'}. We have guessed where we could — check each one.`}
            />
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {IMPORT_FIELDS.map((field) => (
              <Select
                key={field.key}
                label={`${field.label}${field.required ? ' *' : ''}`}
                hint={field.hint}
                value={columnMap[field.key] ?? ''}
                options={[
                  { value: '', label: field.required ? 'Choose a column…' : 'Not in my file' },
                  ...columns.map((column) => ({ value: column, label: column })),
                ]}
                onChange={(event) => {
                  const next = event.target.value;
                  setColumnMap((current) => ({ ...current, [field.key]: next }));
                }}
              />
            ))}
          </div>
        </Card>

        <Card header={<CardTitle title="Where do they go?" />}>
          <Select
            label="Class"
            hint="Every student in this file joins this class. Import one class at a time."
            options={sectionOptions}
            value={sectionId}
            onChange={(event) => {
              setSectionId(event.target.value);
            }}
          />
        </Card>

        <Card
          header={
            <CardTitle
              title="The first few rows"
              description="How your file reads with the mapping above."
            />
          }
          className="p-0"
        >
          <div className="overflow-x-auto">
            <Table caption="Rows to import" className="rounded-none border-0">
              <TableHead>
                <TableRow>
                  {IMPORT_FIELDS.filter((field) => columnMap[field.key] !== undefined && columnMap[field.key] !== '').map(
                    (field) => (
                      <TableHeaderCell key={field.key}>
                        {field.label}
                      </TableHeaderCell>
                    ),
                  )}
                </TableRow>
              </TableHead>
              <TableBody>
                {preview.map((row, index) => (
                  <TableRow key={index}>
                    {IMPORT_FIELDS.filter(
                      (field) => columnMap[field.key] !== undefined && columnMap[field.key] !== '',
                    ).map((field) => (
                      <TableCell key={field.key}>
                        {row[columnMap[field.key]!] ?? ''}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {previewProblems.length > 0 ? (
            <div className="border-t border-line bg-status-warning-subtle px-5 py-3 text-sm text-status-warning-onSubtle">
              <p className="font-medium">
                Problems in these first {preview.length} rows:
              </p>
              <ul className="mt-1 space-y-1">
                {previewProblems.map((entry) => (
                  <li key={entry.row}>
                    Row {entry.row} — {entry.errors.join(' ')}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs">
                This is a sample, not the whole file. Check it to see all{' '}
                {rowCount} rows.
              </p>
            </div>
          ) : null}
        </Card>

        <div className="flex gap-3">
          <Button
            isLoading={busy}
            disabled={sectionId === ''}
            onClick={() => {
              void validate();
            }}
          >
            Check the file
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setStep('choose');
              setBatchId(null);
              setError(null);
            }}
          >
            Start over
          </Button>
        </div>
      </div>
    );
  }

  // Steps three and four render the same report; only the wording and the
  // action below it differ, because it is the same list of rows either way.
  const isDone = step === 'done';
  const willImport = counts?.pending ?? 0;

  return (
    <div className="space-y-4">
      {banner}

      <Card
        header={
          <CardTitle
            title={isDone ? 'Imported' : 'What will happen'}
            description={
              isDone
                ? `${counts?.created ?? 0} student${(counts?.created ?? 0) === 1 ? '' : 's'} added from ${fileName}.`
                : `${fileName} · nothing has been saved yet.`
            }
          />
        }
      >
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['pending', counts?.pending ?? 0, 'neutral'],
              ['created', counts?.created ?? 0, 'success'],
              ['skipped', counts?.skipped ?? 0, 'neutral'],
              ['invalid', counts?.invalid ?? 0, 'warning'],
              ['failed', counts?.failed ?? 0, 'danger'],
            ] as const
          )
            .filter(([, value]) => value > 0)
            .map(([key, value, variant]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setShown(key);
                  if (batchId !== null) void loadReport(batchId, key);
                }}
                className={
                  shown === key
                    ? 'rounded-lg border border-brand-primary px-3 py-1.5'
                    : 'rounded-lg border border-transparent px-3 py-1.5 hover:border-line-strong'
                }
              >
                <Badge variant={variant}>
                  {value} {OUTCOME_LABELS[key]}
                </Badge>
              </button>
            ))}
        </div>

        {(counts?.invalid ?? 0) > 0 && !isDone ? (
          <p className="mt-4 text-sm text-ink-muted">
            Rows that need fixing are <strong>not</strong> imported and nothing
            else is held up by them. Import the rest now and fix those in a
            second file, or start over with a corrected one — importing the same
            file twice does not create anybody twice.
          </p>
        ) : null}
      </Card>

      <Card className="p-0" header={<CardTitle title={OUTCOME_LABELS[shown] ?? 'Rows'} />}>
        <div className="overflow-x-auto">
          <Table caption="Rows with problems" className="rounded-none border-0">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Row</TableHeaderCell>
                <TableHeaderCell>Student</TableHeaderCell>
                <TableHeaderCell>Guardian</TableHeaderCell>
                <TableHeaderCell>What we found</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell muted className="text-sm" colSpan={4}>
                    Nothing in this group.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell muted className="font-mono text-xs">
                      {row.rowNumber}
                    </TableCell>
                    <TableCell>
                      {row.raw[columnMap['name'] ?? ''] ?? '—'}
                    </TableCell>
                    <TableCell muted>
                      {row.raw[columnMap['guardianName'] ?? ''] ?? '—'}
                    </TableCell>
                    <TableCell muted>
                      {row.errors.length === 0 ? '—' : row.errors.join(' ')}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {isDone ? (
        <Button
          onClick={() => {
            setStep('choose');
            setBatchId(null);
            setCounts(null);
            setRows([]);
            setError(null);
          }}
        >
          Import another file
        </Button>
      ) : (
        <div className="flex gap-3">
          <Button
            isLoading={busy}
            disabled={willImport === 0}
            onClick={() => {
              void commit();
            }}
          >
            Import {willImport} student{willImport === 1 ? '' : 's'}
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setStep('map');
              setError(null);
            }}
          >
            Back to mapping
          </Button>
        </div>
      )}
    </div>
  );
}
