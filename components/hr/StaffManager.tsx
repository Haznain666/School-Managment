'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { PhoneField } from '@/components/ui/PhoneField';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { Select } from '@/components/ui/Select';
import {
  EMPLOYMENT_TYPE_LABELS,
  EMPLOYMENT_TYPES,
  STAFF_STATUS_LABELS,
  STAFF_STATUSES,
  type EmploymentType,
  type StaffStatus,
} from '@/db/schema/staff';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * The staff directory, with the form that adds to it.
 *
 * Only the fields a school cannot proceed without are on the create form —
 * code, name, designation, joining date. Everything else (identity, bank, next
 * of kin) is on the detail screen, because a school entering forty staff at
 * setup should not have to complete forty long forms before payroll can be
 * configured at all.
 */

interface StaffRow {
  id: string;
  employeeCode: string;
  fullName: string;
  designation: string | null;
  department: string | null;
  employmentType: EmploymentType | null;
  status: StaffStatus;
  joinedOn: string | null;
  phone: string | null;
  branchName: string | null;
}

export interface StaffManagerProps {
  canEdit: boolean;
}

const STATUS_FILTER_OPTIONS = STAFF_STATUSES.map((value) => ({
  value,
  label: STAFF_STATUS_LABELS[value],
}));

const EMPLOYMENT_OPTIONS = [
  { value: '', label: 'Not set' },
  ...EMPLOYMENT_TYPES.map((value) => ({
    value,
    label: EMPLOYMENT_TYPE_LABELS[value],
  })),
];

const STATUS_VARIANT: Record<StaffStatus, 'success' | 'warning' | 'danger'> = {
  active: 'success',
  on_leave: 'warning',
  resigned: 'danger',
};

interface Draft {
  employeeCode: string;
  firstName: string;
  lastName: string;
  designation: string;
  department: string;
  employmentType: string;
  joinedOn: string;
  phone: string;
  email: string;
  isClassTeacher: boolean;
}

const EMPTY_DRAFT: Draft = {
  employeeCode: '',
  firstName: '',
  lastName: '',
  designation: '',
  department: '',
  employmentType: 'full_time',
  joinedOn: '',
  phone: '',
  email: '',
  // The restrictive default. A school names its class teachers deliberately.
  isClassTeacher: false,
};

export function StaffManager({ canEdit }: StaffManagerProps) {
  const [rows, setRows] = useState<StaffRow[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  /*
   * The whole directory arrives once and is searched, sorted and paged in the
   * browser.
   *
   * This is the one listing where that is the right answer rather than the lazy
   * one: a school's staff is bounded by its payroll — tens, occasionally a
   * couple of hundred — where students and challans are not. Filtering here
   * used to cost a round trip per keystroke for a list that fits in memory
   * several times over.
   */
  const load = useCallback(async () => {
    try {
      const payload = await schoolFetch<{ staff: StaffRow[] }>('/api/school/hr/staff');
      setRows(payload.staff);
      setError(null);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not load the staff directory.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (): Promise<void> => {
    if (draft === null) return;

    if (draft.employeeCode.trim() === '') {
      setError('Give the staff member an employee code.');
      return;
    }

    if (draft.firstName.trim() === '' || draft.lastName.trim() === '') {
      setError('Enter the first and last name.');
      return;
    }

    setBusy('save');
    setError(null);

    try {
      await schoolFetch('/api/school/hr/staff', {
        method: 'POST',
        body: JSON.stringify({
          employeeCode: draft.employeeCode.trim(),
          firstName: draft.firstName.trim(),
          lastName: draft.lastName.trim(),
          designation: draft.designation.trim(),
          department: draft.department.trim(),
          employmentType: draft.employmentType === '' ? null : draft.employmentType,
          joinedOn: draft.joinedOn === '' ? null : draft.joinedOn,
          phone: draft.phone.trim(),
          email: draft.email.trim(),
          isClassTeacher: draft.isClassTeacher,
        }),
      });
      setDraft(null);
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not add the staff member.'));
    } finally {
      setBusy(null);
    }
  };

  const staffColumns: Array<DataTableColumn<StaffRow>> = [
    {
      id: 'name',
      header: 'Name',
      sortValue: (row) => row.fullName,
      searchValue: (row) =>
        `${row.fullName} ${row.employeeCode} ${row.designation ?? ''} ${row.department ?? ''}`,
      cell: (row) => (
        <>
          <p className="font-medium text-ink">{row.fullName}</p>
          {row.department === null ? null : (
            <p className="text-xs text-ink-muted">{row.department}</p>
          )}
        </>
      ),
    },
    {
      id: 'code',
      header: 'Code',
      muted: true,
      sortValue: (row) => row.employeeCode,
      cell: (row) => row.employeeCode,
    },
    {
      id: 'designation',
      header: 'Designation',
      muted: true,
      sortValue: (row) => row.designation,
      cell: (row) => row.designation ?? '—',
    },
    {
      id: 'branch',
      header: 'Branch',
      muted: true,
      sortValue: (row) => row.branchName,
      cell: (row) => row.branchName ?? 'All branches',
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (row) => STAFF_STATUS_LABELS[row.status],
      cell: (row) => (
        <Badge variant={STATUS_VARIANT[row.status]}>{STAFF_STATUS_LABELS[row.status]}</Badge>
      ),
    },
    {
      id: 'open',
      header: <span className="sr-only">Open</span>,
      align: 'numeric',
      cell: (row) => (
        <Link
          href={`/dashboard/hr/staff/${row.id}`}
          className="text-sm font-medium text-brand-primary hover:underline"
        >
          Open
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {error !== null ? (
        <p role="alert" className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}


      {draft !== null ? (
        <Card
          header={
            <CardTitle
              title="New staff member"
              description="The rest of their file — identity, bank details, next of kin — is added on their own screen."
            />
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Employee code"
              value={draft.employeeCode}
              maxLength={32}
              placeholder="EMP-001"
              onChange={(event) => {
                setDraft({ ...draft, employeeCode: event.target.value });
              }}
            />
            <Select
              label="Employment type"
              options={EMPLOYMENT_OPTIONS}
              value={draft.employmentType}
              onChange={(event) => {
                setDraft({ ...draft, employmentType: event.target.value });
              }}
            />
            <Input
              label="First name"
              value={draft.firstName}
              onChange={(event) => {
                setDraft({ ...draft, firstName: event.target.value });
              }}
            />
            <Input
              label="Last name"
              value={draft.lastName}
              onChange={(event) => {
                setDraft({ ...draft, lastName: event.target.value });
              }}
            />
            <Input
              label="Designation"
              value={draft.designation}
              placeholder="Senior Physics Teacher"
              onChange={(event) => {
                setDraft({ ...draft, designation: event.target.value });
              }}
            />
            <Input
              label="Department"
              value={draft.department}
              placeholder="Science"
              onChange={(event) => {
                setDraft({ ...draft, department: event.target.value });
              }}
            />
            <Input
              label="Joining date"
              type="date"
              value={draft.joinedOn}
              onChange={(event) => {
                setDraft({ ...draft, joinedOn: event.target.value });
              }}
            />
            <PhoneField
              label="Phone"
              value={draft.phone}
              onChange={(next) => {
                setDraft({ ...draft, phone: next });
              }}
            />
            <Input
              label="Email"
              type="email"
              value={draft.email}
              onChange={(event) => {
                setDraft({ ...draft, email: event.target.value });
              }}
            />

            {/* One option, not two. The product owner: "Same thing, one
                option." Only staff marked here are offered in a class's
                class-teacher picker, and only a class teacher may decide that
                class's promotions. */}
            <fieldset>
              <legend className="mb-1 block text-sm font-medium text-ink">
                Class teacher
              </legend>
              <div className="flex flex-wrap gap-4">
                {[
                  { value: true, label: 'Class Teacher (Home Room)' },
                  { value: false, label: 'None' },
                ].map((option) => (
                  <label
                    key={String(option.value)}
                    className="flex items-center gap-2 text-sm text-ink"
                  >
                    <input
                      type="radio"
                      name="isClassTeacher"
                      checked={draft.isClassTeacher === option.value}
                      onChange={() => {
                        setDraft({ ...draft, isClassTeacher: option.value });
                      }}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          <div className="mt-4 flex gap-3">
            <Button
              isLoading={busy === 'save'}
              onClick={() => {
                void save();
              }}
            >
              Save
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setDraft(null);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}

      <DataTable
        caption="Staff"
        columns={staffColumns}
        rows={rows ?? []}
        getRowKey={(row) => row.id}
        pending={rows === null}
        defaultSort={{ columnId: 'name', direction: 'asc' }}
        search={{ placeholder: 'Name, code, designation or department' }}
        filters={[
          {
            id: 'status',
            label: 'Status',
            allLabel: 'All statuses',
            options: STATUS_FILTER_OPTIONS,
            rowValue: (row) => row.status,
          },
          {
            id: 'branch',
            label: 'Branch',
            allLabel: 'Every branch',
            options: [
              ...new Set((rows ?? []).map((row) => row.branchName ?? 'All branches')),
            ].map((name) => ({ value: name, label: name })),
            rowValue: (row) => row.branchName ?? 'All branches',
          },
        ]}
        itemNoun={{ singular: 'staff record', plural: 'staff records' }}
        emptyTitle="No staff recorded yet"
        emptyDescription="Add your staff before setting up payroll — a run pays whoever is active and has a salary structure."
        noResultTitle="No staff match those filters"
        noResultDescription="Widen the status or branch, or clear the search."
        actions={
          canEdit && draft === null ? (
            <Button
              onClick={() => {
                setDraft({ ...EMPTY_DRAFT });
              }}
            >
              Add staff member
            </Button>
          ) : undefined
        }
      />
    </div>
  );
}
