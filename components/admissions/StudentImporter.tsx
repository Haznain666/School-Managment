'use client';

import { useCallback, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { CsvError, MAX_CSV_ROWS, parseCsv } from '@/lib/csv';
import { IMPORT_FIELDS, suggestColumnMap, validateRow } from '@/lib/student-import';

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
      <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
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
            className="block w-full text-sm text-slate-600 file:mr-4 file:rounded-lg file:border-0 file:bg-brand-primary file:px-4 file:py-2 file:text-sm file:font-medium file:text-brand-onPrimary"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) void readFile(file);
            }}
          />

          <p className="mt-4 text-sm text-slate-600">
            Exporting from Excel? Use <strong>Save as → CSV</strong>. An{' '}
            <code>.xlsx</code> file cannot be read directly. Tab-separated files
            work too.
          </p>
          <p className="mt-2 text-sm text-slate-600">
            You will map your columns and see exactly what will happen before
            anything is saved.
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
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  {IMPORT_FIELDS.filter((field) => columnMap[field.key] !== undefined && columnMap[field.key] !== '').map(
                    (field) => (
                      <th key={field.key} scope="col" className="px-4 py-3 font-medium">
                        {field.label}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {preview.map((row, index) => (
                  <tr key={index}>
                    {IMPORT_FIELDS.filter(
                      (field) => columnMap[field.key] !== undefined && columnMap[field.key] !== '',
                    ).map((field) => (
                      <td key={field.key} className="px-4 py-3 text-slate-700">
                        {row[columnMap[field.key]!] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {previewProblems.length > 0 ? (
            <div className="border-t border-slate-200 bg-amber-50 px-5 py-3 text-sm text-amber-900">
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
                    : 'rounded-lg border border-transparent px-3 py-1.5 hover:border-slate-300'
                }
              >
                <Badge variant={variant}>
                  {value} {OUTCOME_LABELS[key]}
                </Badge>
              </button>
            ))}
        </div>

        {(counts?.invalid ?? 0) > 0 && !isDone ? (
          <p className="mt-4 text-sm text-slate-600">
            Rows that need fixing are <strong>not</strong> imported and nothing
            else is held up by them. Import the rest now and fix those in a
            second file, or start over with a corrected one — importing the same
            file twice does not create anybody twice.
          </p>
        ) : null}
      </Card>

      <Card className="p-0" header={<CardTitle title={OUTCOME_LABELS[shown] ?? 'Rows'} />}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Row</th>
                <th scope="col" className="px-4 py-3 font-medium">Student</th>
                <th scope="col" className="px-4 py-3 font-medium">Guardian</th>
                <th scope="col" className="px-4 py-3 font-medium">What we found</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-sm text-slate-500">
                    Nothing in this group.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">
                      {row.rowNumber}
                    </td>
                    <td className="px-4 py-3 text-slate-900">
                      {row.raw[columnMap['name'] ?? ''] ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {row.raw[columnMap['guardianName'] ?? ''] ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {row.errors.length === 0 ? '—' : row.errors.join(' ')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
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
