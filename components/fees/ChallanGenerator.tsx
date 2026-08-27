'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { StudentPicker, type PickedStudent } from '@/components/fees/StudentPicker';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { Input } from '@/components/ui/Input';
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
import { MONTH_NAMES } from '@/db/schema/academic-years';
import { formatAmount, formatPkr } from '@/lib/money';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';
import { cn } from '@/lib/utils';

/**
 * Challan generation, in two modes.
 *
 * Single is for the exception — a late admission, a re-issue. Bulk is the
 * monthly reality: one grade, one click, two hundred bills.
 *
 * Both show what will happen before it happens. Bulk in particular says how
 * many students already hold a challan for the month, because the answer to
 * "will this bill them twice" needs to be visible, not merely true.
 */

export interface AcademicYearOption {
  id: string;
  name: string;
  isActive: boolean;
}

export interface GradeOption {
  id: string;
  label: string;
}

export interface ChallanGeneratorProps {
  academicYears: readonly AcademicYearOption[];
  grades: readonly GradeOption[];
  /** Day of the month challans fall due by default. */
  defaultDueDay: number;
}

interface PreviewItem {
  description: string;
  amount: string;
  concessionAmount: string;
  netAmount: string;
}

interface SectionOption {
  id: string;
  name: string;
}

interface BulkCandidate {
  studentProfileId: string;
  studentName: string;
  studentId: string;
  sectionName: string;
  existingChallanNumber: string | null;
}

const MONTH_OPTIONS = MONTH_NAMES.map((name, index) => ({
  value: String(index + 1),
  label: name,
}));

/** `YYYY-MM-DD` for the given day of a billing month, clamped into range. */
function dueDateFor(month: string, year: string, day: number): string {
  const safeDay = Math.min(Math.max(day, 1), 28);
  return `${year}-${month.padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;
}

type Tab = 'single' | 'bulk';

export function ChallanGenerator({
  academicYears,
  grades,
  defaultDueDay,
}: ChallanGeneratorProps) {
  const now = new Date();

  const [tab, setTab] = useState<Tab>('single');
  const [academicYearId, setAcademicYearId] = useState(
    academicYears.find((year) => year.isActive)?.id ?? academicYears[0]?.id ?? '',
  );
  const [billingMonth, setBillingMonth] = useState(String(now.getMonth() + 1));
  const [billingYear, setBillingYear] = useState(String(now.getFullYear()));
  const [dueDate, setDueDate] = useState(
    dueDateFor(String(now.getMonth() + 1), String(now.getFullYear()), defaultDueDay),
  );

  // Keeps the due date in step with the billing period until the user edits it
  // themselves, at which point their choice stands.
  const [dueDateTouched, setDueDateTouched] = useState(false);

  useEffect(() => {
    if (dueDateTouched) return;
    setDueDate(dueDateFor(billingMonth, billingYear, defaultDueDay));
  }, [billingMonth, billingYear, defaultDueDay, dueDateTouched]);

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Generation mode" className="flex gap-2">
        {(['single', 'bulk'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={cn(
              'rounded-full px-4 py-1.5 text-sm font-medium transition',
              tab === value
                ? 'bg-brand-primary text-brand-onPrimary'
                : 'bg-surface-sunken text-ink-muted hover:bg-line',
            )}
            onClick={() => {
              setTab(value);
            }}
          >
            {value === 'single' ? 'Single student' : 'Bulk generation'}
          </button>
        ))}
      </div>

      <Card>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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

          <Select
            label="Billing month"
            options={MONTH_OPTIONS}
            value={billingMonth}
            onChange={(event) => {
              setBillingMonth(event.target.value);
            }}
          />

          <Input
            label="Billing year"
            type="number"
            min={2000}
            max={2100}
            value={billingYear}
            onChange={(event) => {
              setBillingYear(event.target.value);
            }}
          />

          <Input
            label="Due date"
            type="date"
            value={dueDate}
            hint={dueDateTouched ? undefined : `Defaults to the ${defaultDueDay}th.`}
            onChange={(event) => {
              setDueDateTouched(true);
              setDueDate(event.target.value);
            }}
          />
        </div>
      </Card>

      {tab === 'single' ? (
        <SinglePanel
          academicYearId={academicYearId}
          billingMonth={billingMonth}
          billingYear={billingYear}
          dueDate={dueDate}
        />
      ) : (
        <BulkPanel
          academicYearId={academicYearId}
          billingMonth={billingMonth}
          billingYear={billingYear}
          dueDate={dueDate}
          grades={grades}
        />
      )}
    </div>
  );
}

interface PanelProps {
  academicYearId: string;
  billingMonth: string;
  billingYear: string;
  dueDate: string;
}

function SinglePanel({
  academicYearId,
  billingMonth,
  billingYear,
  dueDate,
}: PanelProps) {
  const router = useRouter();

  const [student, setStudent] = useState<PickedStudent | null>(null);
  const [items, setItems] = useState<PreviewItem[] | null>(null);
  const [totals, setTotals] = useState<{
    subtotal: string;
    concessionAmount: string;
    /** Credit carried forward this challan would spend. `0.00` for most. */
    creditApplied: string;
    totalAmount: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  const studentProfileId = student?.studentProfileId ?? null;

  const loadPreview = useCallback(async () => {
    if (studentProfileId === null || academicYearId === '') {
      setItems(null);
      setTotals(null);
      return;
    }

    setLoading(true);
    setError(null);

    const query = new URLSearchParams({
      studentProfileId,
      academicYearId,
      billingMonth,
      billingYear,
      dueDate,
    });

    try {
      const payload = await schoolFetch<{
        preview: {
          items: PreviewItem[];
          subtotal: string;
          concessionAmount: string;
          creditApplied: string;
          totalAmount: string;
        };
      }>(`/api/school/fees/challans/preview?${query.toString()}`);

      setItems(payload.preview.items);
      setTotals({
        subtotal: payload.preview.subtotal,
        concessionAmount: payload.preview.concessionAmount,
        creditApplied: payload.preview.creditApplied,
        totalAmount: payload.preview.totalAmount,
      });
    } catch (caught) {
      setItems(null);
      setTotals(null);
      setError(schoolErrorMessage(caught, 'Could not price this challan.'));
    } finally {
      setLoading(false);
    }
  }, [studentProfileId, academicYearId, billingMonth, billingYear, dueDate]);

  useEffect(() => {
    void loadPreview();
  }, [loadPreview]);

  const generate = async (): Promise<void> => {
    if (studentProfileId === null) return;

    setGenerating(true);
    setError(null);

    try {
      const payload = await schoolFetch<{ challan: { id: string } }>(
        '/api/school/fees/challans',
        {
          method: 'POST',
          body: JSON.stringify({
            studentProfileId,
            academicYearId,
            billingMonth: Number(billingMonth),
            billingYear: Number(billingYear),
            dueDate,
          }),
        },
      );

      router.push(`/dashboard/fees/challans/${payload.challan.id}`);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not generate the challan.'));
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card header={<CardTitle title="Student" />}>
        <StudentPicker
          academicYearId={academicYearId}
          selected={student}
          onSelect={(next) => {
            setStudent(next);
            setError(null);
          }}
        />
      </Card>

      {error !== null ? (
        <p role="alert" className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}

      {student === null ? null : (
        <Card
          header={
            <CardTitle
              title="What will be billed"
              description="Priced from this grade's fee structure, with the student's concessions applied."
            />
          }
        >
          {loading ? (
            <p className="text-sm text-ink-muted">Pricing…</p>
          ) : items === null || totals === null ? (
            <p className="text-sm text-ink-muted">
              Nothing could be priced for this student and period.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table caption="Students to bill" className="rounded-none border-0">
                  <TableHead>
                    <TableRow>
                      <TableHeaderCell>Fee head</TableHeaderCell>
                      <TableHeaderCell align="numeric">Amount</TableHeaderCell>
                      <TableHeaderCell align="numeric">Concession</TableHeaderCell>
                      <TableHeaderCell align="numeric">Net</TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {items.map((item) => (
                      <TableRow key={item.description}>
                        <TableCell>{item.description}</TableCell>
                        <TableCell align="numeric" muted>
                          {formatAmount(item.amount)}
                        </TableCell>
                        <TableCell align="numeric" muted>
                          {Number(item.concessionAmount) === 0
                            ? '—'
                            : `−${formatAmount(item.concessionAmount)}`}
                        </TableCell>
                        <TableCell rowHeader align="numeric">
                          {formatAmount(item.netAmount)}
                        </TableCell>
                      </TableRow>
                    ))}

                    {/*
                      Credit carried forward, previewed on the same terms the
                      voucher will print it: a line of its own, negative, and
                      not a fee head. Showing it here is what stops a clerk
                      raising a challan for less than expected and having no
                      idea why.
                    */}
                    {Number(totals.creditApplied) === 0 ? null : (
                      <TableRow>
                        <TableCell>Adjustment — credit carried forward</TableCell>
                        <TableCell align="numeric" muted>—</TableCell>
                        <TableCell align="numeric" muted>
                          {`−${formatAmount(totals.creditApplied)}`}
                        </TableCell>
                        <TableCell rowHeader align="numeric">
                          {`−${formatAmount(totals.creditApplied)}`}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                  <TableFoot>
                    <TableRow>
                      <TableCell rowHeader muted colSpan={3}>
                        Total
                      </TableCell>
                      <TableCell align="numeric" className="text-base font-bold">
                        {formatPkr(totals.totalAmount)}
                      </TableCell>
                    </TableRow>
                  </TableFoot>
                </Table>
              </div>

              <Button
                className="mt-4"
                isLoading={generating}
                onClick={() => {
                  void generate();
                }}
              >
                Generate challan
              </Button>
            </>
          )}
        </Card>
      )}
    </div>
  );
}

function BulkPanel({
  academicYearId,
  billingMonth,
  billingYear,
  dueDate,
  grades,
}: PanelProps & { grades: readonly GradeOption[] }) {
  const [gradeId, setGradeId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [sections, setSections] = useState<SectionOption[]>([]);
  const [candidates, setCandidates] = useState<BulkCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{
    generated: number;
    skipped: number;
    failed: number;
    problems: Array<{ studentName: string; reason: string }>;
  } | null>(null);

  useEffect(() => {
    if (gradeId === '' || academicYearId === '') {
      setSections([]);
      setSectionId('');
      return;
    }

    const query = new URLSearchParams({ gradeId, academicYearId });

    schoolFetch<{ sections: SectionOption[] }>(`/api/school/sections?${query.toString()}`)
      .then((payload) => {
        setSections(payload.sections);
      })
      .catch(() => {
        setSections([]);
      });
  }, [gradeId, academicYearId]);

  const loadCandidates = useCallback(async () => {
    if (gradeId === '' || academicYearId === '') {
      setCandidates(null);
      return;
    }

    setLoading(true);
    setError(null);

    const query = new URLSearchParams({
      gradeId,
      academicYearId,
      billingMonth,
      billingYear,
    });
    if (sectionId !== '') query.set('sectionId', sectionId);

    try {
      const payload = await schoolFetch<{ candidates: BulkCandidate[] }>(
        `/api/school/fees/challans/bulk-generate?${query.toString()}`,
      );
      setCandidates(payload.candidates);
    } catch (caught) {
      setCandidates(null);
      setError(schoolErrorMessage(caught, 'Could not load the student list.'));
    } finally {
      setLoading(false);
    }
  }, [gradeId, sectionId, academicYearId, billingMonth, billingYear]);

  useEffect(() => {
    void loadCandidates();
  }, [loadCandidates]);

  const toGenerate = (candidates ?? []).filter(
    (row) => row.existingChallanNumber === null,
  );
  const alreadyBilled = (candidates ?? []).length - toGenerate.length;

  const generate = async (): Promise<void> => {
    setGenerating(true);
    setError(null);
    setResult(null);

    try {
      const payload = await schoolFetch<{
        generated: number;
        skipped: number;
        failed: number;
        problems: Array<{ studentName: string; reason: string }>;
      }>('/api/school/fees/challans/bulk-generate', {
        method: 'POST',
        body: JSON.stringify({
          gradeId,
          sectionId: sectionId === '' ? undefined : sectionId,
          academicYearId,
          billingMonth: Number(billingMonth),
          billingYear: Number(billingYear),
          dueDate,
        }),
      });

      setResult(payload);
      await loadCandidates();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not generate the challans.'));
    } finally {
      setGenerating(false);
    }
  };

  const candidateColumns: Array<DataTableColumn<BulkCandidate>> = [
    {
      id: 'student',
      header: 'Student',
      sortValue: (candidate) => candidate.studentName,
      searchValue: (candidate) => `${candidate.studentName} ${candidate.studentId}`,
      cell: (candidate) => (
        <>
          <span className="font-medium text-ink">{candidate.studentName}</span>
          <span className="block font-mono text-xs text-ink-muted">
            {candidate.studentId}
          </span>
        </>
      ),
    },
    {
      id: 'section',
      header: 'Section',
      muted: true,
      sortValue: (candidate) => candidate.sectionName,
      searchValue: (candidate) => candidate.sectionName,
      cell: (candidate) => candidate.sectionName,
    },
    {
      id: 'billing',
      header: 'This month',
      align: 'end',
      // Sorted so the already-billed rows group together: the reason to sort
      // this column at all is to see the exceptions in one block.
      sortValue: (candidate) => candidate.existingChallanNumber ?? '',
      cell: (candidate) =>
        candidate.existingChallanNumber === null ? (
          <span className="text-xs text-ink-muted">Will be billed</span>
        ) : (
          <span className="font-mono text-xs text-status-warning-ink">
            {candidate.existingChallanNumber}
          </span>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <Card header={<CardTitle title="Who to bill" />}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Grade"
            options={[
              { value: '', label: 'Choose a grade…' },
              ...grades.map((grade) => ({ value: grade.id, label: grade.label })),
            ]}
            value={gradeId}
            onChange={(event) => {
              setGradeId(event.target.value);
              setResult(null);
            }}
          />

          <Select
            label="Section"
            options={[
              { value: '', label: 'All sections' },
              ...sections.map((section) => ({ value: section.id, label: section.name })),
            ]}
            value={sectionId}
            disabled={gradeId === ''}
            hint="Leave as all sections to bill the whole grade."
            onChange={(event) => {
              setSectionId(event.target.value);
              setResult(null);
            }}
          />
        </div>
      </Card>

      {error !== null ? (
        <p role="alert" className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}

      {result !== null ? (
        <Card>
          <h3 className="text-base font-semibold text-ink">Generation complete</h3>
          <p className="mt-1 text-sm text-ink-muted">
            {result.generated} challan{result.generated === 1 ? '' : 's'} generated,{' '}
            {result.skipped} skipped because a challan already existed
            {result.failed > 0 ? `, ${result.failed} failed` : ''}.
          </p>

          {result.problems.length > 0 ? (
            <ul className="mt-3 space-y-1 text-sm text-status-warning-ink">
              {result.problems.map((problem) => (
                <li key={problem.studentName}>
                  {problem.studentName}: {problem.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      ) : null}

      {gradeId === '' ? null : (
        <Card
          header={
            <CardTitle
              title="Students"
              description={
                loading
                  ? 'Checking who has already been billed…'
                  : `${toGenerate.length} to generate · ${alreadyBilled} already billed for this month.`
              }
              action={
                <Button
                  disabled={toGenerate.length === 0}
                  isLoading={generating}
                  onClick={() => {
                    void generate();
                  }}
                >
                  Generate all ({toGenerate.length})
                </Button>
              }
            />
          }
        >
          {alreadyBilled > 0 ? (
            <p className="mb-3 rounded-lg bg-status-warning-subtle px-3 py-2 text-sm text-status-warning-onSubtle">
              {alreadyBilled} student{alreadyBilled === 1 ? ' already holds' : 's already hold'}{' '}
              a challan for this month. They will be skipped, not billed twice.
            </p>
          ) : null}

          {/*
            A scrolling list of two hundred names answered "who is in this
            grade" and never the question actually being asked before a bulk
            run, which is "which of them is already billed". It is a table now,
            filtered on exactly that.
          */}
          <DataTable
            caption="Students to bill"
            columns={candidateColumns}
            rows={candidates ?? []}
            getRowKey={(candidate) => candidate.studentProfileId}
            pending={loading}
            defaultSort={{ columnId: 'student', direction: 'asc' }}
            search={{ placeholder: 'Name or student ID' }}
            filters={[
              {
                id: 'billed',
                label: 'Billing',
                allLabel: 'Everyone here',
                options: [
                  { value: 'pending', label: 'Will be billed' },
                  { value: 'billed', label: 'Already billed' },
                ],
                rowValue: (candidate) =>
                  candidate.existingChallanNumber === null ? 'pending' : 'billed',
              },
              {
                id: 'section',
                label: 'Section',
                allLabel: 'Every section',
                options: [
                  ...new Set((candidates ?? []).map((candidate) => candidate.sectionName)),
                ].map((name) => ({ value: name, label: name })),
                rowValue: (candidate) => candidate.sectionName,
              },
            ]}
            itemNoun={{ singular: 'student', plural: 'students' }}
            emptyTitle="Nobody to bill"
            emptyDescription="No active students are enrolled here for the selected academic year."
            noResultTitle="No students match those filters"
            noResultDescription="Widen the section or the billing filter to see the rest of the grade."
          />
        </Card>
      )}
    </div>
  );
}
