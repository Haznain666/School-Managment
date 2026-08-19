'use client';

import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { AddressAutocomplete } from '@/components/ui/AddressAutocomplete';
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
import { GENDERS } from '@/db/schema/student-profiles';
import type { ComponentCalculation, ComponentKind } from '@/db/schema/salary-components';
import { formatPkr, toPaise } from '@/lib/money';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * One staff member: their file, and the salary structure payroll reads.
 *
 * The structure is a matrix rather than a list of add-buttons, because the
 * question an HR manager is answering is "what does this person get under each
 * of our heads?" — and a blank against a head is a real answer. Percentage
 * heads show their computed rupee value live, from the same arithmetic the
 * payslip will use, so nobody discovers at run time that 45% of basic was not
 * the figure they had in mind.
 */

interface StaffDetail {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  fullName: string;
  designation: string | null;
  department: string | null;
  employmentType: EmploymentType | null;
  status: StaffStatus;
  joinedOn: string | null;
  resignedOn: string | null;
  phone: string | null;
  email: string | null;
  cnic: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  address: string | null;
  qualification: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  bankAccountTitle: string | null;
  bankAccountNumber: string | null;
  bankName: string | null;
  branchName: string | null;
}

interface ComponentRow {
  id: string;
  name: string;
  kind: ComponentKind;
  calculation: ComponentCalculation;
  defaultPercentBasisPoints: number | null;
  isBasic: boolean;
  sortOrder: number;
}

interface StructureRow {
  componentId: string;
  amount: string;
  percentBasisPoints: number | null;
}

export interface StaffDetailPanelProps {
  staffId: string;
  canEdit: boolean;
}

const STATUS_OPTIONS = STAFF_STATUSES.map((value) => ({
  value,
  label: STAFF_STATUS_LABELS[value],
}));

const EMPLOYMENT_OPTIONS = [
  { value: '', label: 'Not set' },
  ...EMPLOYMENT_TYPES.map((value) => ({ value, label: EMPLOYMENT_TYPE_LABELS[value] })),
];

const GENDER_OPTIONS = [
  { value: '', label: 'Not set' },
  ...GENDERS.map((value) => ({
    value,
    label: value.charAt(0).toUpperCase() + value.slice(1),
  })),
];

/** What the caller has typed against each component, keyed by component id. */
type Matrix = Record<string, { included: boolean; amount: string; percent: string }>;

function buildMatrix(
  components: readonly ComponentRow[],
  structure: readonly StructureRow[],
): Matrix {
  const assigned = new Map(structure.map((row) => [row.componentId, row]));

  const matrix: Matrix = {};
  for (const component of components) {
    const row = assigned.get(component.id);
    const points = row?.percentBasisPoints ?? component.defaultPercentBasisPoints ?? 0;

    matrix[component.id] = {
      included: row !== undefined,
      amount: row === undefined ? '' : String(Number.parseFloat(row.amount)),
      percent: String(points / 100),
    };
  }

  return matrix;
}

export function StaffDetailPanel({ staffId, canEdit }: StaffDetailPanelProps) {
  const [detail, setDetail] = useState<StaffDetail | null>(null);
  const [components, setComponents] = useState<ComponentRow[]>([]);
  const [matrix, setMatrix] = useState<Matrix>({});
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [staffPayload, salaryPayload] = await Promise.all([
        schoolFetch<{ staff: StaffDetail }>(`/api/school/hr/staff/${staffId}`),
        schoolFetch<{ structure: StructureRow[]; components: ComponentRow[] }>(
          `/api/school/hr/staff/${staffId}/salary`,
        ),
      ]);

      setDetail(staffPayload.staff);
      setComponents(salaryPayload.components);
      setMatrix(buildMatrix(salaryPayload.components, salaryPayload.structure));

      const record = staffPayload.staff;
      setForm({
        firstName: record.firstName,
        lastName: record.lastName,
        designation: record.designation ?? '',
        department: record.department ?? '',
        employmentType: record.employmentType ?? '',
        status: record.status,
        joinedOn: record.joinedOn ?? '',
        resignedOn: record.resignedOn ?? '',
        phone: record.phone ?? '',
        email: record.email ?? '',
        cnic: record.cnic ?? '',
        dateOfBirth: record.dateOfBirth ?? '',
        gender: record.gender ?? '',
        address: record.address ?? '',
        qualification: record.qualification ?? '',
        emergencyContactName: record.emergencyContactName ?? '',
        emergencyContactPhone: record.emergencyContactPhone ?? '',
        bankAccountTitle: record.bankAccountTitle ?? '',
        bankAccountNumber: record.bankAccountNumber ?? '',
        bankName: record.bankName ?? '',
      });

      setError(null);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not load this staff member.'));
    }
  }, [staffId]);

  useEffect(() => {
    void load();
  }, [load]);

  const setField = (key: string, value: string): void => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const saveProfile = async (): Promise<void> => {
    setBusy('profile');
    setError(null);
    setNotice(null);

    try {
      await schoolFetch(`/api/school/hr/staff/${staffId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...form,
          employmentType: form.employmentType === '' ? null : form.employmentType,
          gender: form.gender === '' ? null : form.gender,
          joinedOn: form.joinedOn === '' ? null : form.joinedOn,
          resignedOn: form.resignedOn === '' ? null : form.resignedOn,
          dateOfBirth: form.dateOfBirth === '' ? null : form.dateOfBirth,
        }),
      });
      setNotice('Saved.');
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not save the changes.'));
    } finally {
      setBusy(null);
    }
  };

  const basicPaise = (() => {
    const basic = components.find((component) => component.isBasic);
    if (basic === undefined) return 0;

    const entry = matrix[basic.id];
    return entry === undefined || !entry.included ? 0 : toPaise(entry.amount);
  })();

  /** The rupee value a row will contribute, using the payslip's own arithmetic. */
  const rowValuePaise = (component: ComponentRow): number => {
    const entry = matrix[component.id];
    if (entry === undefined || !entry.included) return 0;

    if (component.calculation === 'percent_of_basic') {
      const percent = Number(entry.percent);
      if (!Number.isFinite(percent)) return 0;
      return Math.round((basicPaise * percent) / 100);
    }

    return toPaise(entry.amount);
  };

  const grossPaise = components
    .filter((component) => component.kind === 'earning')
    .reduce((sum, component) => sum + rowValuePaise(component), 0);

  const deductionsPaise = components
    .filter((component) => component.kind === 'deduction')
    .reduce((sum, component) => sum + rowValuePaise(component), 0);

  const saveSalary = async (): Promise<void> => {
    setBusy('salary');
    setError(null);
    setNotice(null);

    const assignments = components
      .filter((component) => matrix[component.id]?.included === true)
      .map((component) => {
        const entry = matrix[component.id];
        return component.calculation === 'percent_of_basic'
          ? {
              componentId: component.id,
              percentBasisPoints: Math.round(Number(entry?.percent ?? 0) * 100),
            }
          : { componentId: component.id, amount: entry?.amount ?? '0' };
      });

    try {
      await schoolFetch(`/api/school/hr/staff/${staffId}/salary`, {
        method: 'PATCH',
        body: JSON.stringify({ assignments }),
      });
      setNotice('Salary structure saved.');
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not save the salary structure.'));
    } finally {
      setBusy(null);
    }
  };

  if (detail === null) {
    return (
      <Card>
        <p className="text-sm text-ink-muted">
          {error ?? 'Loading staff member…'}
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
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

      <Card
        header={
          <CardTitle
            title={detail.fullName}
            description={`${detail.employeeCode}${detail.branchName === null ? '' : ` · ${detail.branchName}`}`}
            action={<Badge>{STAFF_STATUS_LABELS[detail.status]}</Badge>}
          />
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="First name"
            value={form.firstName ?? ''}
            disabled={!canEdit}
            onChange={(event) => {
              setField('firstName', event.target.value);
            }}
          />
          <Input
            label="Last name"
            value={form.lastName ?? ''}
            disabled={!canEdit}
            onChange={(event) => {
              setField('lastName', event.target.value);
            }}
          />
          <Input
            label="Designation"
            value={form.designation ?? ''}
            disabled={!canEdit}
            onChange={(event) => {
              setField('designation', event.target.value);
            }}
          />
          <Input
            label="Department"
            value={form.department ?? ''}
            disabled={!canEdit}
            onChange={(event) => {
              setField('department', event.target.value);
            }}
          />
          <Select
            label="Employment type"
            options={EMPLOYMENT_OPTIONS}
            value={form.employmentType ?? ''}
            disabled={!canEdit}
            onChange={(event) => {
              setField('employmentType', event.target.value);
            }}
          />
          <Select
            label="Status"
            options={STATUS_OPTIONS}
            value={form.status ?? 'active'}
            disabled={!canEdit}
            hint="A resigned member is skipped by every future payroll run."
            onChange={(event) => {
              setField('status', event.target.value);
            }}
          />
          <Input
            label="Joining date"
            type="date"
            value={form.joinedOn ?? ''}
            disabled={!canEdit}
            onChange={(event) => {
              setField('joinedOn', event.target.value);
            }}
          />
          <Input
            label="Leaving date"
            type="date"
            value={form.resignedOn ?? ''}
            disabled={!canEdit}
            onChange={(event) => {
              setField('resignedOn', event.target.value);
            }}
          />
          <PhoneField
            label="Phone"
            value={form.phone ?? ''}
            disabled={!canEdit}
            onChange={(next) => {
              setField('phone', next);
            }}
          />
          <Input
            label="Email"
            type="email"
            value={form.email ?? ''}
            disabled={!canEdit}
            onChange={(event) => {
              setField('email', event.target.value);
            }}
          />
          <Input
            label="CNIC"
            value={form.cnic ?? ''}
            disabled={!canEdit}
            placeholder="35201-1234567-1"
            onChange={(event) => {
              setField('cnic', event.target.value);
            }}
          />
          <Input
            label="Date of birth"
            type="date"
            value={form.dateOfBirth ?? ''}
            disabled={!canEdit}
            onChange={(event) => {
              setField('dateOfBirth', event.target.value);
            }}
          />
          <Select
            label="Gender"
            options={GENDER_OPTIONS}
            value={form.gender ?? ''}
            disabled={!canEdit}
            onChange={(event) => {
              setField('gender', event.target.value);
            }}
          />
          <Input
            label="Qualification"
            value={form.qualification ?? ''}
            disabled={!canEdit}
            placeholder="M.Sc. Physics"
            onChange={(event) => {
              setField('qualification', event.target.value);
            }}
          />
          <Input
            label="Emergency contact"
            value={form.emergencyContactName ?? ''}
            disabled={!canEdit}
            onChange={(event) => {
              setField('emergencyContactName', event.target.value);
            }}
          />
          <PhoneField
            label="Emergency phone"
            value={form.emergencyContactPhone ?? ''}
            disabled={!canEdit}
            onChange={(next) => {
              setField('emergencyContactPhone', next);
            }}
          />
          <Input
            label="Bank account title"
            value={form.bankAccountTitle ?? ''}
            disabled={!canEdit}
            hint="Copied onto every payslip at the moment it is raised."
            onChange={(event) => {
              setField('bankAccountTitle', event.target.value);
            }}
          />
          <Input
            label="Bank account number"
            value={form.bankAccountNumber ?? ''}
            disabled={!canEdit}
            onChange={(event) => {
              setField('bankAccountNumber', event.target.value);
            }}
          />
          <Input
            label="Bank name"
            value={form.bankName ?? ''}
            disabled={!canEdit}
            onChange={(event) => {
              setField('bankName', event.target.value);
            }}
          />
          <AddressAutocomplete
            label="Address"
            // `staff` has no latitude/longitude pair — a home address is a
            // postal fact here, never a map pin — so the search assists the
            // typing and stops there.
            withCoordinates={false}
            value={{ address: form.address ?? '', latitude: null, longitude: null }}
            disabled={!canEdit}
            onChange={(next) => {
              setField('address', next.address);
            }}
          />
        </div>

        {canEdit ? (
          <div className="mt-4">
            <Button
              isLoading={busy === 'profile'}
              onClick={() => {
                void saveProfile();
              }}
            >
              Save details
            </Button>
          </div>
        ) : null}
      </Card>

      <Card
        header={
          <CardTitle
            title="Salary structure"
            description="Tick each head this person receives. Percentage heads are computed from the basic salary."
          />
        }
        className="p-0"
      >
        {components.length === 0 ? (
          <div className="px-5 py-4">
            <p className="text-sm text-ink-muted">
              Your school has no salary components yet. Set them up before
              assigning anyone a structure.
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table caption="Salary structure" className="rounded-none border-0">
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Include</TableHeaderCell>
                    <TableHeaderCell>Component</TableHeaderCell>
                    <TableHeaderCell>Amount / rate</TableHeaderCell>
                    <TableHeaderCell>Value</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {components.map((component) => {
                    const entry = matrix[component.id] ?? {
                      included: false,
                      amount: '',
                      percent: '0',
                    };

                    return (
                      <TableRow key={component.id}>
                        <TableCell>
                          <input
                            type="checkbox"
                            aria-label={`Include ${component.name}`}
                            checked={entry.included}
                            disabled={!canEdit}
                            className="h-4 w-4 rounded border-line-strong"
                            onChange={(event) => {
                              setMatrix({
                                ...matrix,
                                [component.id]: {
                                  ...entry,
                                  included: event.target.checked,
                                },
                              });
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          <p className="font-medium text-ink">
                            {component.name}
                            {component.isBasic ? (
                              <Badge className="ml-2" variant="success">
                                Basic
                              </Badge>
                            ) : null}
                          </p>
                          <p className="text-xs text-ink-muted">
                            {component.kind === 'earning' ? 'Earning' : 'Deduction'}
                          </p>
                        </TableCell>
                        <TableCell>
                          {component.calculation === 'percent_of_basic' ? (
                            <Input
                              label={`${component.name} percentage`}
                              hideLabel
                              type="number"
                              min={0}
                              max={1000}
                              step={0.01}
                              className="max-w-[9rem]"
                              value={entry.percent}
                              disabled={!canEdit || !entry.included}
                              onChange={(event) => {
                                setMatrix({
                                  ...matrix,
                                  [component.id]: {
                                    ...entry,
                                    percent: event.target.value,
                                  },
                                });
                              }}
                            />
                          ) : (
                            <Input
                              label={`${component.name} amount`}
                              hideLabel
                              type="number"
                              min={0}
                              step={1}
                              className="max-w-[9rem]"
                              value={entry.amount}
                              disabled={!canEdit || !entry.included}
                              onChange={(event) => {
                                setMatrix({
                                  ...matrix,
                                  [component.id]: {
                                    ...entry,
                                    amount: event.target.value,
                                  },
                                });
                              }}
                            />
                          )}
                        </TableCell>
                        <TableCell>
                          {entry.included ? formatPkr(rowValuePaise(component) / 100) : '—'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line bg-surface-sunken px-5 py-3">
              <dl className="flex flex-wrap gap-6 text-sm">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-ink-muted">
                    Gross
                  </dt>
                  <dd className="font-semibold text-ink">
                    {formatPkr(grossPaise / 100)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-ink-muted">
                    Deductions
                  </dt>
                  <dd className="font-semibold text-ink">
                    {formatPkr(deductionsPaise / 100)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-ink-muted">
                    Net, before any unpaid days
                  </dt>
                  <dd className="font-semibold text-ink">
                    {formatPkr(Math.max(0, grossPaise - deductionsPaise) / 100)}
                  </dd>
                </div>
              </dl>

              {canEdit ? (
                <Button
                  isLoading={busy === 'salary'}
                  onClick={() => {
                    void saveSalary();
                  }}
                >
                  Save structure
                </Button>
              ) : null}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
