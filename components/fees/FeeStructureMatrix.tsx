'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import {
  Table,
  TableBody,
  TableCell,
  TableFoot,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@/components/ui/Table';
import { FEE_CATEGORY_LABELS, type FeeCategory } from '@/db/schema/fee-types';
import { formatAmount } from '@/lib/money';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * The price list, as a grid: grades down, fee heads across.
 *
 * It is a grid because that is how a school thinks about fees — "Class 5 pays
 * 4,500 tuition and 800 transport" — and because setting twelve grades one form
 * at a time is how a bursar comes to hate their software.
 *
 * A blank cell and a zero are different statements: blank means the grade is
 * not charged that head at all, zero means it is charged nothing. Save All
 * sends the whole grid in one request, so the year's prices change together.
 */

interface FeeTypeColumn {
  id: string;
  name: string;
  feeCategory: FeeCategory;
}

interface GradeRow {
  id: string;
  label: string;
  sortOrder: number;
}

interface MatrixResponse {
  feeTypes: FeeTypeColumn[];
  grades: GradeRow[];
  cells: Array<{ feeTypeId: string; gradeId: string; amount: string }>;
}

export interface BranchOption {
  id: string;
  name: string;
}

export interface AcademicYearOption {
  id: string;
  name: string;
  isActive: boolean;
}

export interface FeeStructureMatrixProps {
  branches: readonly BranchOption[];
  academicYears: readonly AcademicYearOption[];
  /** branch_admin is pinned to one branch and cannot widen the filter. */
  lockedBranchId: string | null;
  canEdit: boolean;
}

/** `feeTypeId:gradeId` — the key the draft grid is stored under. */
function cellKey(feeTypeId: string, gradeId: string): string {
  return `${feeTypeId}:${gradeId}`;
}

export function FeeStructureMatrix({
  branches,
  academicYears,
  lockedBranchId,
  canEdit,
}: FeeStructureMatrixProps) {
  const defaultYear =
    academicYears.find((year) => year.isActive)?.id ?? academicYears[0]?.id ?? '';

  const [academicYearId, setAcademicYearId] = useState(defaultYear);
  const [branchId, setBranchId] = useState(lockedBranchId ?? branches[0]?.id ?? '');
  const [matrix, setMatrix] = useState<MatrixResponse | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copyFrom, setCopyFrom] = useState('');

  const load = useCallback(async () => {
    if (academicYearId === '') return;

    setMatrix(null);
    setNotice(null);

    try {
      const query = new URLSearchParams({ academicYearId });
      if (branchId !== '') query.set('branchId', branchId);

      const payload = await schoolFetch<MatrixResponse>(
        `/api/school/fees/structures?${query.toString()}`,
      );

      setMatrix(payload);
      setDraft(
        Object.fromEntries(
          payload.cells.map((cell) => [
            cellKey(cell.feeTypeId, cell.gradeId),
            // Trailing `.00` is noise in an input the bursar is about to retype.
            String(Number(cell.amount)),
          ]),
        ),
      );
      setError(null);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not load the fee structure.'));
    }
  }, [academicYearId, branchId]);

  useEffect(() => {
    void load();
  }, [load]);

  const originals = useMemo(
    () =>
      new Map(
        (matrix?.cells ?? []).map((cell) => [
          cellKey(cell.feeTypeId, cell.gradeId),
          String(Number(cell.amount)),
        ]),
      ),
    [matrix],
  );

  const changedKeys = useMemo(() => {
    const keys = new Set<string>([...originals.keys(), ...Object.keys(draft)]);
    return [...keys].filter((key) => (draft[key] ?? '') !== (originals.get(key) ?? ''));
  }, [draft, originals]);

  const saveAll = async (): Promise<void> => {
    if (matrix === null || changedKeys.length === 0) return;

    setBusy('save');
    setError(null);
    setNotice(null);

    const cells = changedKeys.map((key) => {
      const [feeTypeId = '', gradeId = ''] = key.split(':');
      const raw = (draft[key] ?? '').trim();
      return { feeTypeId, gradeId, amount: raw === '' ? null : Number(raw) };
    });

    try {
      const result = await schoolFetch<{ saved: number; cleared: number }>(
        '/api/school/fees/structures',
        { method: 'POST', body: JSON.stringify({ academicYearId, cells }) },
      );

      setNotice(
        `Saved ${result.saved} amount${result.saved === 1 ? '' : 's'}` +
          (result.cleared > 0 ? `, cleared ${result.cleared}.` : '.'),
      );
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not save the fee structure.'));
    } finally {
      setBusy(null);
    }
  };

  const copyYear = async (): Promise<void> => {
    if (copyFrom === '' || academicYearId === '') return;

    setBusy('copy');
    setError(null);
    setNotice(null);

    try {
      const result = await schoolFetch<{ copied: number }>(
        '/api/school/fees/structures/copy',
        {
          method: 'POST',
          body: JSON.stringify({
            fromAcademicYearId: copyFrom,
            toAcademicYearId: academicYearId,
            branchId: branchId === '' ? undefined : branchId,
          }),
        },
      );

      setNotice(
        `Copied ${result.copied} amount${result.copied === 1 ? '' : 's'}. Existing prices were left as they were.`,
      );
      setCopyFrom('');
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not copy the fee structure.'));
    } finally {
      setBusy(null);
    }
  };

  const yearOptions = academicYears.map((year) => ({
    value: year.id,
    label: year.isActive ? `${year.name} (active)` : year.name,
  }));

  const columnTotal = (feeTypeId: string): number =>
    (matrix?.grades ?? []).reduce(
      (sum, grade) => sum + (Number(draft[cellKey(feeTypeId, grade.id)] ?? '') || 0),
      0,
    );

  const rowTotal = (gradeId: string): number =>
    (matrix?.feeTypes ?? []).reduce(
      (sum, feeType) => sum + (Number(draft[cellKey(feeType.id, gradeId)] ?? '') || 0),
      0,
    );

  return (
    <div className="space-y-4">
      <Card>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Select
            label="Academic year"
            options={yearOptions}
            value={academicYearId}
            placeholder={yearOptions.length === 0 ? 'No academic years' : undefined}
            onChange={(event) => {
              setAcademicYearId(event.target.value);
            }}
          />

          <Select
            label="Branch"
            options={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
            value={branchId}
            disabled={lockedBranchId !== null}
            hint={lockedBranchId === null ? undefined : 'Fixed to your own branch.'}
            onChange={(event) => {
              setBranchId(event.target.value);
            }}
          />

          {canEdit ? (
            <div className="sm:col-span-2 flex flex-wrap items-end gap-3">
              <div className="min-w-[12rem] flex-1">
                <Select
                  label="Copy prices from"
                  options={[
                    { value: '', label: 'Choose a year…' },
                    ...academicYears
                      .filter((year) => year.id !== academicYearId)
                      .map((year) => ({ value: year.id, label: year.name })),
                  ]}
                  value={copyFrom}
                  onChange={(event) => {
                    setCopyFrom(event.target.value);
                  }}
                />
              </div>
              <Button
                variant="secondary"
                disabled={copyFrom === ''}
                isLoading={busy === 'copy'}
                onClick={() => {
                  void copyYear();
                }}
              >
                Copy
              </Button>
            </div>
          ) : null}
        </div>
      </Card>

      {error !== null ? (
        <p role="alert" className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}

      {notice !== null ? (
        <p className="rounded-lg bg-status-success-subtle px-3 py-2 text-sm text-status-success-ink">
          {notice}
        </p>
      ) : null}

      {matrix === null ? (
        <Card>
          <p className="text-sm text-ink-muted">
            {academicYearId === ''
              ? 'Choose an academic year to price.'
              : 'Loading the fee structure…'}
          </p>
        </Card>
      ) : matrix.feeTypes.length === 0 || matrix.grades.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-muted">
            {matrix.feeTypes.length === 0
              ? 'No active fee types exist yet. Set those up first — there is nothing to price without them.'
              : 'This branch has no grades yet. Set up its grade ladder in Admissions first.'}
          </p>
        </Card>
      ) : (
        <Card
          header={
            <CardTitle
              title="Fee structure"
              description="Amounts in PKR, per grade per head. Leave a cell blank if the grade is not charged that head."
              action={
                canEdit ? (
                  <Button
                    size="sm"
                    disabled={changedKeys.length === 0}
                    isLoading={busy === 'save'}
                    onClick={() => {
                      void saveAll();
                    }}
                  >
                    {changedKeys.length === 0
                      ? 'Save all'
                      : `Save all (${changedKeys.length})`}
                  </Button>
                ) : undefined
              }
            />
          }
          className="p-0"
        >
          <div className="overflow-x-auto">
            <Table caption="Fee structure by grade" className="rounded-none border-0">
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Grade</TableHeaderCell>
                  {matrix.feeTypes.map((feeType) => (
                    <TableHeaderCell key={feeType.id}>
                      <span className="block text-ink">{feeType.name}</span>
                      <span className="block font-normal normal-case text-ink-muted">
                        {FEE_CATEGORY_LABELS[feeType.feeCategory]}
                      </span>
                    </TableHeaderCell>
                  ))}
                  <TableHeaderCell align="numeric">Total</TableHeaderCell>
                </TableRow>
              </TableHead>

              <TableBody>
                {matrix.grades.map((grade) => (
                  <TableRow key={grade.id}>
                    <TableCell rowHeader>
                      {grade.label}
                    </TableCell>

                    {matrix.feeTypes.map((feeType) => {
                      const key = cellKey(feeType.id, grade.id);
                      return (
                        <TableCell key={feeType.id}>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            inputMode="decimal"
                            aria-label={`${feeType.name} for ${grade.label}`}
                            disabled={!canEdit}
                            value={draft[key] ?? ''}
                            placeholder="—"
                            className="w-28 rounded-lg border border-line-strong bg-surface-raised px-2 py-1.5 text-right text-sm text-ink focus:outline focus:outline-2 focus:outline-brand-primary disabled:bg-surface-sunken disabled:text-ink-muted"
                            onChange={(event) => {
                              setDraft((current) => ({
                                ...current,
                                [key]: event.target.value,
                              }));
                            }}
                          />
                        </TableCell>
                      );
                    })}

                    <TableCell rowHeader align="numeric">
                      {formatAmount(rowTotal(grade.id))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>

              <TableFoot>
                <TableRow>
                  <TableCell rowHeader muted>
                    All grades
                  </TableCell>
                  {matrix.feeTypes.map((feeType) => (
                    <TableCell align="numeric" muted key={feeType.id}>
                      {formatAmount(columnTotal(feeType.id))}
                    </TableCell>
                  ))}
                  <TableCell align="numeric" className="font-semibold">
                    {formatAmount(
                      matrix.grades.reduce((sum, grade) => sum + rowTotal(grade.id), 0),
                    )}
                  </TableCell>
                </TableRow>
              </TableFoot>
            </Table>
          </div>
        </Card>
      )}
    </div>
  );
}
