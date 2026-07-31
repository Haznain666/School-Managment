'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { FEE_CATEGORY_LABELS, type FeeCategory } from '@/db/schema/fee-types';
import { formatPkr, parsePaise } from '@/lib/money';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * The fee structure matrix: grades down, fee heads across.
 *
 * Edited as a grid and saved in one request, because that is how the work
 * actually happens — an admin sets a whole year's fees in one sitting, and
 * thirty separate saves would leave the matrix half-written if the tab closed.
 *
 * A blank cell means "not charged" and is stored as the absence of a row, not
 * as zero. A zero would print a zero-rupee line on every challan.
 */

export interface MatrixFeeType {
  id: string;
  name: string;
  feeCategory: FeeCategory;
}

export interface MatrixGrade {
  gradeId: string;
  gradeName: string;
  sortOrder: number;
  amounts: Record<string, string>;
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
  canEdit: boolean;
}

interface MatrixResponse {
  feeTypes: MatrixFeeType[];
  grades: MatrixGrade[];
}

/** Cell key — a grade and a fee head together identify one amount. */
function cellKey(gradeId: string, feeTypeId: string): string {
  return `${gradeId}:${feeTypeId}`;
}

export function FeeStructureMatrix({
  branches,
  academicYears,
  canEdit,
}: FeeStructureMatrixProps) {
  const activeYearId =
    academicYears.find((year) => year.isActive)?.id ?? academicYears[0]?.id ?? '';

  const [branchId, setBranchId] = useState(branches[0]?.id ?? '');
  const [academicYearId, setAcademicYearId] = useState(activeYearId);
  const [copyFromYearId, setCopyFromYearId] = useState('');

  const [matrix, setMatrix] = useState<MatrixResponse | null>(null);
  /** Working copy. Only cells the user touched differ from what was loaded. */
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    if (branchId === '' || academicYearId === '') {
      setMatrix(null);
      return;
    }

    setError(null);

    try {
      const query = new URLSearchParams({ branchId, academicYearId });
      const payload = await schoolFetch<MatrixResponse>(
        `/api/school/fees/structures?${query.toString()}`,
      );

      setMatrix(payload);

      const next: Record<string, string> = {};
      for (const grade of payload.grades) {
        for (const [feeTypeId, amount] of Object.entries(grade.amounts)) {
          next[cellKey(grade.gradeId, feeTypeId)] = amount;
        }
      }
      setDraft(next);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not load the fee structure.'));
    }
  }, [branchId, academicYearId]);

  useEffect(() => {
    void load();
  }, [load]);

  const setCell = (gradeId: string, feeTypeId: string, value: string): void => {
    setDraft((current) => ({ ...current, [cellKey(gradeId, feeTypeId)]: value }));
  };

  /** Per-grade monthly total, so an admin can sanity-check a row at a glance. */
  const monthlyTotals = useMemo(() => {
    if (matrix === null) return {};

    const monthlyTypeIds = new Set(
      matrix.feeTypes
        .filter((feeType) => feeType.feeCategory === 'monthly')
        .map((feeType) => feeType.id),
    );

    const totals: Record<string, number> = {};
    for (const grade of matrix.grades) {
      let sum = 0;
      for (const feeTypeId of monthlyTypeIds) {
        sum += parsePaise(draft[cellKey(grade.gradeId, feeTypeId)] ?? '') ?? 0;
      }
      totals[grade.gradeId] = sum;
    }
    return totals;
  }, [matrix, draft]);

  const save = async (): Promise<void> => {
    if (matrix === null) return;

    setIsSaving(true);
    setError(null);
    setNotice(null);

    const cells = matrix.grades.flatMap((grade) =>
      matrix.feeTypes.map((feeType) => ({
        gradeId: grade.gradeId,
        feeTypeId: feeType.id,
        academicYearId,
        amount: draft[cellKey(grade.gradeId, feeType.id)] ?? '',
      })),
    );

    try {
      const result = await schoolFetch<{ saved: number; cleared: number }>(
        '/api/school/fees/structures',
        { method: 'POST', body: JSON.stringify({ cells }) },
      );

      setNotice(
        `Saved ${result.saved} amount${result.saved === 1 ? '' : 's'}` +
          (result.cleared > 0 ? `, cleared ${result.cleared}.` : '.'),
      );
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not save the fee structure.'));
    } finally {
      setIsSaving(false);
    }
  };

  /**
   * Copies another year's amounts into this one's *draft*, not the database —
   * the admin still reviews and presses save. Fees usually rise between years,
   * so landing last year's numbers straight into the table would be worse than
   * useless.
   */
  const copyFromYear = async (): Promise<void> => {
    if (copyFromYearId === '' || branchId === '') return;

    setError(null);
    setNotice(null);

    try {
      const query = new URLSearchParams({
        branchId,
        academicYearId: copyFromYearId,
      });
      const payload = await schoolFetch<MatrixResponse>(
        `/api/school/fees/structures?${query.toString()}`,
      );

      const next: Record<string, string> = {};
      for (const grade of payload.grades) {
        for (const [feeTypeId, amount] of Object.entries(grade.amounts)) {
          next[cellKey(grade.gradeId, feeTypeId)] = amount;
        }
      }

      setDraft(next);
      setNotice(
        'Copied into the table below. Review the amounts and press Save to apply them.',
      );
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not copy that year.'));
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Select
          label="Branch"
          options={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
          value={branchId}
          onChange={(event) => {
            setBranchId(event.target.value);
          }}
        />
        <Select
          label="Academic year"
          options={academicYears.map((year) => ({
            value: year.id,
            label: year.isActive ? `${year.name} (active)` : year.name,
          }))}
          value={academicYearId}
          onChange={(event) => {
            setAcademicYearId(event.target.value);
          }}
        />
        {canEdit && academicYears.length > 1 ? (
          <div className="flex items-end gap-2">
            <Select
              label="Copy amounts from"
              placeholder="Select a year"
              options={academicYears
                .filter((year) => year.id !== academicYearId)
                .map((year) => ({ value: year.id, label: year.name }))}
              value={copyFromYearId}
              onChange={(event) => {
                setCopyFromYearId(event.target.value);
              }}
            />
            <Button
              variant="secondary"
              disabled={copyFromYearId === ''}
              onClick={() => {
                void copyFromYear();
              }}
            >
              Copy
            </Button>
          </div>
        ) : null}
      </div>

      {error !== null ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {notice !== null ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice}
        </p>
      ) : null}

      {matrix === null ? (
        <Card>
          <p className="text-sm text-slate-500">Loading the fee structure…</p>
        </Card>
      ) : matrix.feeTypes.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-600">
            No active fee heads. Set them up first — there is nothing to price
            until then.
          </p>
        </Card>
      ) : matrix.grades.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-600">
            This branch has no grades yet. Initialise them on the Admissions
            Grades &amp; Sections page first.
          </p>
        </Card>
      ) : (
        <>
          <Card
            className="p-0"
            header={
              <CardTitle
                title="Amounts per grade"
                description="Leave a cell blank where a grade is not charged that head. All amounts in PKR."
              />
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="sticky left-0 bg-white px-4 py-3 font-medium">
                      Grade
                    </th>
                    {matrix.feeTypes.map((feeType) => (
                      <th key={feeType.id} scope="col" className="px-3 py-3 font-medium">
                        {feeType.name}
                        <span className="block text-[10px] font-normal normal-case text-slate-400">
                          {FEE_CATEGORY_LABELS[feeType.feeCategory]}
                        </span>
                      </th>
                    ))}
                    <th scope="col" className="px-4 py-3 font-medium">Monthly total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {matrix.grades.map((grade) => (
                    <tr key={grade.gradeId}>
                      <th
                        scope="row"
                        className="sticky left-0 bg-white px-4 py-2 text-left font-medium text-slate-900"
                      >
                        {grade.gradeName}
                      </th>
                      {matrix.feeTypes.map((feeType) => (
                        <td key={feeType.id} className="px-3 py-2">
                          <input
                            type="text"
                            inputMode="decimal"
                            aria-label={`${grade.gradeName} — ${feeType.name}`}
                            placeholder="—"
                            disabled={!canEdit || isSaving}
                            value={draft[cellKey(grade.gradeId, feeType.id)] ?? ''}
                            onChange={(event) => {
                              setCell(grade.gradeId, feeType.id, event.target.value);
                            }}
                            className="w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:outline focus:outline-2 focus:outline-brand-primary disabled:bg-slate-50"
                          />
                        </td>
                      ))}
                      <td className="px-4 py-2 font-medium text-slate-700">
                        {formatPkr(monthlyTotals[grade.gradeId] ?? 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {canEdit ? (
            <div className="flex items-center gap-3">
              <Button
                isLoading={isSaving}
                onClick={() => {
                  void save();
                }}
              >
                Save all
              </Button>
              <p className="text-sm text-slate-500">
                Saving replaces every amount for this branch and year.
              </p>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
