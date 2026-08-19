'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { PhoneField } from '@/components/ui/PhoneField';
import { Select } from '@/components/ui/Select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@/components/ui/Table';
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

const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'All statuses' },
  ...STAFF_STATUSES.map((value) => ({ value, label: STAFF_STATUS_LABELS[value] })),
];

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
};

export function StaffManager({ canEdit }: StaffManagerProps) {
  const [rows, setRows] = useState<StaffRow[] | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (search.trim() !== '') params.set('search', search.trim());
    if (status !== '') params.set('status', status);

    const query = params.toString();

    try {
      const payload = await schoolFetch<{ staff: StaffRow[] }>(
        `/api/school/hr/staff${query === '' ? '' : `?${query}`}`,
      );
      setRows(payload.staff);
      setError(null);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not load the staff directory.'));
    }
  }, [search, status]);

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

  return (
    <div className="space-y-4">
      {error !== null ? (
        <p role="alert" className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}

      <Card>
        <div className="grid gap-4 sm:grid-cols-3">
          <Input
            label="Search"
            placeholder="Name, code or designation"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
          <Select
            label="Status"
            options={STATUS_FILTER_OPTIONS}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
            }}
          />
          {canEdit && draft === null ? (
            <div className="flex items-end">
              <Button
                onClick={() => {
                  setDraft({ ...EMPTY_DRAFT });
                }}
              >
                Add staff member
              </Button>
            </div>
          ) : null}
        </div>
      </Card>

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

      {rows === null ? (
        <Card>
          <p className="text-sm text-ink-muted">Loading staff…</p>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-muted">
            No staff match this filter. Add your staff before setting up payroll —
            a run pays whoever is active and has a salary structure.
          </p>
        </Card>
      ) : (
        <Card
          header={
            <CardTitle
              title="Staff"
              description={`${rows.length} record${rows.length === 1 ? '' : 's'}.`}
            />
          }
          className="p-0"
        >
          <div className="overflow-x-auto">
            <Table caption="Staff" className="rounded-none border-0">
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Name</TableHeaderCell>
                  <TableHeaderCell>Code</TableHeaderCell>
                  <TableHeaderCell>Designation</TableHeaderCell>
                  <TableHeaderCell>Branch</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>
                    <span className="sr-only">Open</span>
                  </TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <p className="font-medium text-ink">{row.fullName}</p>
                      {row.department === null ? null : (
                        <p className="text-xs text-ink-muted">{row.department}</p>
                      )}
                    </TableCell>
                    <TableCell muted>{row.employeeCode}</TableCell>
                    <TableCell muted>
                      {row.designation ?? '—'}
                    </TableCell>
                    <TableCell muted>
                      {row.branchName ?? 'All branches'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[row.status]}>
                        {STAFF_STATUS_LABELS[row.status]}
                      </Badge>
                    </TableCell>
                    <TableCell align="numeric">
                      <Link
                        href={`/dashboard/hr/staff/${row.id}`}
                        className="text-sm font-medium text-brand-primary hover:underline"
                      >
                        Open
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
    </div>
  );
}
