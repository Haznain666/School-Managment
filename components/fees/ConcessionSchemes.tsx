'use client';

import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Toggle } from '@/components/ui/Toggle';
import {
  SCHEME_TYPES,
  SCHEME_TYPE_LABELS,
  type SchemeType,
} from '@/db/schema/concession-schemes';
import {
  DISCOUNT_TYPES,
  DISCOUNT_TYPE_LABELS,
  type DiscountType,
} from '@/db/schema/student-concessions';
import { formatDateOnly } from '@/lib/dates';
import { formatPkr } from '@/lib/money';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * Concession schemes — the discount a school owns.
 *
 * ── What a scheme is, and what it is not ─────────────────────────────────
 * It is the decision the school made once: "Sibling Discount, 20%, every fee
 * head, from 1 August". It is **not** a grant. Creating one gives nobody a
 * discount; applying it to a set of students does, and that writes an ordinary
 * `student_concessions` row per child with the scheme's name, rate, dates and
 * fee heads **frozen onto it**.
 *
 * That separation is the whole design and is worth stating on the screen as
 * well as in the code: editing a scheme in March changes what the *next* child
 * granted it receives, and touches nobody who already holds it. A school that
 * means "everybody now gets 15%" removes the grants and applies the amended
 * scheme again — two deliberate actions, each of which says what it is about to
 * do.
 *
 * ── An empty fee-head set means every head ───────────────────────────────
 * Said on the field, because this is where somebody chooses. STATE.md §5be
 * records what the narrow reading cost: an unqualified sibling discount that
 * silently never reached an admission, annual or examination fee, for twelve
 * sprints, indistinguishable on screen from a discount the school never
 * granted.
 */

export interface SchemeFeeTypeOption {
  id: string;
  name: string;
}

interface SchemeRow {
  id: string;
  name: string;
  schemeType: SchemeType;
  discountType: DiscountType;
  discountValue: string;
  validFrom: string;
  validUntil: string | null;
  isActive: boolean;
  notes: string | null;
  feeTypeIds: string[];
  feeTypeNames: string[];
  grantedCount: number;
}

interface StudentRow {
  studentProfileId: string;
  studentId: string;
  name: string;
  gradeName: string;
  sectionName: string;
}

export interface ConcessionSchemesProps {
  feeTypes: readonly SchemeFeeTypeOption[];
  canEdit: boolean;
}

interface SchemeDraft {
  id: string | null;
  name: string;
  schemeType: SchemeType;
  discountType: DiscountType;
  discountValue: string;
  feeTypeIds: string[];
  validFrom: string;
  validUntil: string;
  isActive: boolean;
  notes: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyDraft(): SchemeDraft {
  return {
    id: null,
    name: '',
    /*
     * `other` is the default the *form* offers, matching the migration's
     * backfill. A new scheme is not assumed to be a sibling discount because
     * the operator has not answered yet, and the dropdown sits above the name
     * so the question is asked before the name suggests an answer.
     */
    schemeType: 'other',
    discountType: 'percentage',
    discountValue: '',
    feeTypeIds: [],
    validFrom: today(),
    validUntil: '',
    isActive: true,
    notes: '',
  };
}

function describeScheme(scheme: SchemeRow): string {
  const rate =
    scheme.discountType === 'percentage'
      ? `${String(Number(scheme.discountValue))}%`
      : formatPkr(scheme.discountValue);

  const scope =
    scheme.feeTypeNames.length === 0
      ? 'every fee head'
      : scheme.feeTypeNames.join(', ');

  return `${rate} off ${scope}`;
}

export function ConcessionSchemes({ feeTypes, canEdit }: ConcessionSchemesProps) {
  const [schemes, setSchemes] = useState<SchemeRow[] | null>(null);
  const [draft, setDraft] = useState<SchemeDraft | null>(null);
  const [applying, setApplying] = useState<SchemeRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const payload = await schoolFetch<{ schemes: SchemeRow[] }>(
        '/api/school/fees/concession-schemes',
      );
      setSchemes(payload.schemes);
      setError(null);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not load the schemes.'));
      setSchemes([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (): Promise<void> => {
    if (draft === null) return;

    setBusy(true);
    setError(null);

    const body = JSON.stringify({
      name: draft.name.trim(),
      schemeType: draft.schemeType,
      discountType: draft.discountType,
      discountValue: Number(draft.discountValue),
      feeTypeIds: draft.feeTypeIds,
      validFrom: draft.validFrom,
      validUntil: draft.validUntil === '' ? null : draft.validUntil,
      isActive: draft.isActive,
      notes: draft.notes.trim(),
    });

    try {
      if (draft.id === null) {
        await schoolFetch('/api/school/fees/concession-schemes', { method: 'POST', body });
        setNotice(`“${draft.name.trim()}” created. It grants nobody anything until you apply it.`);
      } else {
        await schoolFetch(`/api/school/fees/concession-schemes/${draft.id}`, {
          method: 'PATCH',
          body,
        });
        setNotice(
          `“${draft.name.trim()}” updated. Everyone who already holds it keeps the rate they were granted.`,
        );
      }

      setDraft(null);
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not save the scheme.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (scheme: SchemeRow): Promise<void> => {
    setBusy(true);
    setError(null);

    try {
      await schoolFetch(`/api/school/fees/concession-schemes/${scheme.id}`, {
        method: 'DELETE',
      });
      setNotice(
        `“${scheme.name}” removed. The ${String(scheme.grantedCount)} student${
          scheme.grantedCount === 1 ? '' : 's'
        } who hold it keep their discount.`,
      );
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not remove the scheme.'));
    } finally {
      setBusy(false);
    }
  };

  const columns: Array<DataTableColumn<SchemeRow>> = [
    {
      id: 'name',
      header: 'Scheme',
      rowHeader: true,
      sortValue: (row) => row.name,
      searchValue: (row) => `${row.name} ${row.feeTypeNames.join(' ')}`,
      cell: (row) => (
        <>
          {row.name}
          <span className="block text-xs font-normal text-ink-muted">
            {describeScheme(row)}
          </span>
        </>
      ),
    },
    {
      /*
       * Item 5. A column and not a badge on the name: the type is the thing a
       * school scans this list for once it has more than three schemes — "which
       * one is our sibling discount" — and a word inside a cell is easier to
       * scan down than a chip beside a longer string.
       */
      id: 'schemeType',
      header: 'Type',
      muted: true,
      sortValue: (row) => SCHEME_TYPE_LABELS[row.schemeType],
      searchValue: (row) => SCHEME_TYPE_LABELS[row.schemeType],
      cell: (row) => SCHEME_TYPE_LABELS[row.schemeType],
    },
    {
      id: 'window',
      header: 'In force',
      muted: true,
      sortValue: (row) => row.validFrom,
      cell: (row) =>
        `${formatDateOnly(row.validFrom)} — ${
          row.validUntil === null ? 'open ended' : formatDateOnly(row.validUntil)
        }`,
    },
    {
      id: 'granted',
      header: 'Students',
      kind: 'number',
      sortValue: (row) => row.grantedCount,
      cell: (row) => row.grantedCount,
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (row) => (row.isActive ? 1 : 0),
      cell: (row) => (
        <Badge variant={row.isActive ? 'success' : 'neutral'}>
          {row.isActive ? 'Active' : 'Switched off'}
        </Badge>
      ),
    },
  ];

  if (canEdit) {
    columns.push({
      id: 'actions',
      header: 'Actions',
      align: 'end',
      cell: (row) => (
        <div className="flex flex-nowrap justify-end gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setError(null);
              setNotice(null);
              setApplying(row);
            }}
          >
            Apply to students
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setError(null);
              setNotice(null);
              setDraft({
                id: row.id,
                name: row.name,
                schemeType: row.schemeType,
                discountType: row.discountType,
                discountValue: String(Number(row.discountValue)),
                feeTypeIds: row.feeTypeIds,
                validFrom: row.validFrom,
                validUntil: row.validUntil ?? '',
                isActive: row.isActive,
                notes: row.notes ?? '',
              });
            }}
          >
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              void remove(row);
            }}
          >
            Delete
          </Button>
        </div>
      ),
    });
  }

  return (
    <div className="space-y-4">
      {error === null ? null : (
        <p
          role="alert"
          className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink"
        >
          {error}
        </p>
      )}

      {notice === null ? null : (
        <p
          role="status"
          className="rounded-lg bg-status-success-subtle px-3 py-2 text-sm text-status-success-onSubtle"
        >
          {notice}
        </p>
      )}

      <Card
        className="p-0"
        header={
          <CardTitle
            title="Schemes"
            description="A discount the school owns. Creating one grants nobody anything; applying it does, and freezes its rate onto each child."
            action={
              canEdit ? (
                <Button
                  size="sm"
                  onClick={() => {
                    setError(null);
                    setNotice(null);
                    setDraft(emptyDraft());
                  }}
                >
                  New scheme
                </Button>
              ) : undefined
            }
          />
        }
      >
        <DataTable
          caption="Concession schemes"
          columns={columns}
          rows={schemes ?? []}
          getRowKey={(row) => row.id}
          pending={schemes === null}
          filters={[
            {
              id: 'schemeType',
              label: 'Type',
              allLabel: 'Every kind',
              options: SCHEME_TYPES.map((value) => ({
                value,
                label: SCHEME_TYPE_LABELS[value],
              })),
              rowValue: (row) => row.schemeType,
            },
          ]}
          search={{ placeholder: 'Scheme or fee head' }}
          itemNoun={{ singular: 'scheme', plural: 'schemes' }}
          emptyTitle="No schemes yet"
          emptyDescription="Define the discounts your school offers once, and apply them to students by name."
          noResultTitle="No schemes match that search"
          noResultDescription="Clear the search box."
        />
      </Card>

      <Modal
        open={draft !== null}
        size="lg"
        title={draft?.id === null ? 'New scheme' : 'Edit scheme'}
        description="Editing changes what the next student granted this receives. Everyone who already holds it keeps the rate they were granted."
        onClose={() => {
          if (!busy) setDraft(null);
        }}
        footer={
          <>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setDraft(null);
              }}
            >
              Cancel
            </Button>
            <Button
              isLoading={busy}
              disabled={
                draft === null ||
                draft.name.trim() === '' ||
                !(Number(draft.discountValue) > 0)
              }
              onClick={() => {
                void save();
              }}
            >
              Save scheme
            </Button>
          </>
        }
      >
        {draft === null ? null : (
          <div className="grid gap-4 sm:grid-cols-2">
            {/*
              Above the name, deliberately (item 5).

              The question "what kind of discount is this" has to be answered
              before the name is typed, or the answer becomes a reading of the
              name — which is exactly the drift `concession_schemes` exists to
              end, and exactly what the migration refuses to do when it
              backfills every existing row to `other` rather than guessing.
            */}
            <div className="sm:col-span-2">
              <Select
                label="Kind of discount"
                options={SCHEME_TYPES.map((value) => ({
                  value,
                  label: SCHEME_TYPE_LABELS[value],
                }))}
                value={draft.schemeType}
                disabled={busy}
                hint="Decides where this appears when somebody applies a discount to a student. It does not change what the discount is worth."
                onChange={(event) => {
                  setDraft({ ...draft, schemeType: event.target.value as SchemeType });
                }}
              />
            </div>

            <Input
              label="Name"
              required
              placeholder="e.g. Sibling Discount"
              value={draft.name}
              disabled={busy}
              onChange={(event) => {
                setDraft({ ...draft, name: event.target.value });
              }}
            />

            <Select
              label="Discount type"
              options={DISCOUNT_TYPES.map((value) => ({
                value,
                label: DISCOUNT_TYPE_LABELS[value],
              }))}
              value={draft.discountType}
              disabled={busy}
              onChange={(event) => {
                setDraft({ ...draft, discountType: event.target.value as DiscountType });
              }}
            />

            <Input
              label={draft.discountType === 'percentage' ? 'Percentage' : 'Amount (PKR)'}
              inputMode="decimal"
              required
              value={draft.discountValue}
              disabled={busy}
              onChange={(event) => {
                setDraft({ ...draft, discountValue: event.target.value });
              }}
            />

            <Toggle
              checked={draft.isActive}
              onChange={(next) => {
                setDraft({ ...draft, isActive: next });
              }}
              disabled={busy}
              label="Available to grant"
              description="Switching it off leaves every existing grant exactly as it is."
            />

            {/*
              Empty is the wide case. See this file's docblock and STATE.md §5be.
            */}
            <div className="sm:col-span-2">
              <MultiSelect
                label="Applies to"
                options={feeTypes.map((feeType) => ({
                  value: feeType.id,
                  label: feeType.name,
                }))}
                value={draft.feeTypeIds}
                disabled={busy}
                hint="Leave every box unticked for a discount on every fee head, of every category."
                emptyMessage="This school has no fee heads yet."
                onChange={(next) => {
                  setDraft({ ...draft, feeTypeIds: next });
                }}
              />
            </div>

            <Input
              label="Valid from"
              type="date"
              value={draft.validFrom}
              disabled={busy}
              onChange={(event) => {
                setDraft({ ...draft, validFrom: event.target.value });
              }}
            />

            <Input
              label="Valid until"
              type="date"
              hint="Leave blank for an open-ended scheme."
              value={draft.validUntil}
              disabled={busy}
              onChange={(event) => {
                setDraft({ ...draft, validUntil: event.target.value });
              }}
            />

            <div className="sm:col-span-2">
              <Textarea
                label="Notes"
                value={draft.notes}
                disabled={busy}
                onChange={(event) => {
                  setDraft({ ...draft, notes: event.target.value });
                }}
              />
            </div>
          </div>
        )}
      </Modal>

      {applying === null ? null : (
        <SchemeApplyPicker
          scheme={applying}
          onClose={() => {
            setApplying(null);
          }}
          onApplied={(message) => {
            setApplying(null);
            setNotice(message);
            void load();
          }}
        />
      )}
    </div>
  );
}

/**
 * Choosing who gets a scheme.
 *
 * ── Why the search is the whole control ──────────────────────────────────
 * The question is "which children", and a school answers it by naming them or
 * by naming a class. Both go through the student directory the school already
 * knows, which searches by name and admission number and filters by grade and
 * section, so this is that endpoint with checkboxes rather than a second search
 * with its own rules.
 *
 * Students who already hold the scheme are skipped by the server and counted,
 * because running the picker again after admitting three more siblings is the
 * *expected* use of it and must not stack a second discount on the first.
 */
function SchemeApplyPicker({
  scheme,
  onClose,
  onApplied,
}: {
  scheme: SchemeRow;
  onClose: () => void;
  onApplied: (message: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [students, setStudents] = useState<StudentRow[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const find = async (): Promise<void> => {
    setBusy(true);
    setError(null);

    try {
      const query = new URLSearchParams({ limit: '100' });
      if (search.trim() !== '') query.set('search', search.trim());

      const payload = await schoolFetch<{ students: StudentRow[] }>(
        `/api/school/students?${query.toString()}`,
      );
      setStudents(payload.students);
    } catch (caught) {
      setStudents([]);
      setError(schoolErrorMessage(caught, 'Could not search for students.'));
    } finally {
      setBusy(false);
    }
  };

  const apply = async (): Promise<void> => {
    setBusy(true);
    setError(null);

    try {
      const result = await schoolFetch<{
        granted: number;
        skipped: number;
        repricedVouchers: number;
      }>(`/api/school/fees/concession-schemes/${scheme.id}/apply`, {
        method: 'POST',
        body: JSON.stringify({ studentProfileIds: selected }),
      });

      onApplied(
        `“${scheme.name}” granted to ${String(result.granted)} student${
          result.granted === 1 ? '' : 's'
        }${result.skipped === 0 ? '' : `, ${String(result.skipped)} already had it`}. ` +
          `${String(result.repricedVouchers)} open voucher${
            result.repricedVouchers === 1 ? '' : 's'
          } repriced.`,
      );
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not apply the scheme.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      size="lg"
      title={`Apply “${scheme.name}” to students`}
      description="Each student gets their own grant, carrying this scheme's rate and dates as they stand today. Anything they still owe is repriced."
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            isLoading={busy}
            disabled={selected.length === 0}
            onClick={() => {
              void apply();
            }}
          >
            Grant to {selected.length} student{selected.length === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error === null ? null : (
          <p
            role="alert"
            className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink"
          >
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-80">
            <Input
              label="Find students"
              placeholder="Name, admission number or class"
              value={search}
              disabled={busy}
              onChange={(event) => {
                setSearch(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void find();
              }}
            />
          </div>
          <Button
            variant="secondary"
            isLoading={busy && students === null}
            onClick={() => {
              void find();
            }}
          >
            Search
          </Button>
        </div>

        {students === null ? (
          <p className="text-sm text-ink-muted">
            Search for a name, an admission number or a class to begin.
          </p>
        ) : students.length === 0 ? (
          <p className="text-sm text-ink-muted">No enrolled student matched that.</p>
        ) : (
          <ul className="max-h-72 divide-y divide-line overflow-y-auto">
            {students.map((student) => (
              <li
                key={student.studentProfileId}
                className="flex items-center gap-3 py-2"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  aria-label={`Grant to ${student.name}`}
                  checked={selected.includes(student.studentProfileId)}
                  disabled={busy}
                  onChange={(event) => {
                    setSelected((current) =>
                      event.target.checked
                        ? [...current, student.studentProfileId]
                        : current.filter((id) => id !== student.studentProfileId),
                    );
                  }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-ink">{student.name}</span>
                  <span className="block font-mono text-xs text-ink-muted">
                    {student.studentId} · {student.gradeName} {student.sectionName}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
