'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { AddressAutocomplete } from '@/components/ui/AddressAutocomplete';
import { CnicField } from '@/components/ui/CnicField';
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
import { DATE_INPUT_HINT, maxJoiningDate } from '@/lib/dates';
import { formatPkr, toPaise } from '@/lib/money';
import { schoolErrorMessage, schoolFetch, withSchoolParam } from '@/lib/school-client';
import {
  BRANCH_REQUIRED_ROLES,
  INVITABLE_ROLES,
  ROLE_LABELS,
  isUserRole,
} from '@/types/school-auth';

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
  branchId: string | null;
  isClassTeacher: boolean;
  schoolUserId: string | null;
  /** The personnel photograph, or null (Sprint 23, item 5). */
  photoUrl: string | null;
}

/** The portal account this record is joined to, when there is one. */
interface LinkedAccount {
  id: string;
  name: string;
  role: string;
  branchName: string | null;
  isActive: boolean;
  authUserId: string | null;
}

interface PortalAccountOption {
  id: string;
  name: string;
  role: string;
  phone: string;
  email: string | null;
  branchName: string | null;
}

type AccessDelivery =
  | { queued: true; firstTime: boolean; email: string }
  | { queued: false; reason: string };

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
  /** `users.write` — may mint a login for this person. */
  canCreateLogin: boolean;
  /** `users.read` — may be shown, and offered, the portal directory. */
  canSeeAccounts: boolean;
  branches: ReadonlyArray<{ id: string; name: string }>;
}

const STATUS_OPTIONS = STAFF_STATUSES.map((value) => ({
  value,
  label: STAFF_STATUS_LABELS[value],
}));

const EMPLOYMENT_OPTIONS = [
  { value: '', label: 'Not set' },
  ...EMPLOYMENT_TYPES.map((value) => ({ value, label: EMPLOYMENT_TYPE_LABELS[value] })),
];

/** Students and parents are absent for the same reason `InviteForm` omits them. */
const ROLE_OPTIONS = INVITABLE_ROLES.map((role) => ({
  value: role,
  label: ROLE_LABELS[role],
}));

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

export function StaffDetailPanel({
  staffId,
  canEdit,
  canCreateLogin,
  canSeeAccounts,
  branches,
}: StaffDetailPanelProps) {
  const [detail, setDetail] = useState<StaffDetail | null>(null);
  const [account, setAccount] = useState<LinkedAccount | null>(null);
  const [accounts, setAccounts] = useState<PortalAccountOption[] | null>(null);
  const [accountsPending, setAccountsPending] = useState(false);
  const [linkChoice, setLinkChoice] = useState('');
  const [loginRole, setLoginRole] = useState('');
  const [loginBranchId, setLoginBranchId] = useState('');
  const [portalPanel, setPortalPanel] = useState<'closed' | 'link' | 'create'>('closed');
  const [components, setComponents] = useState<ComponentRow[]>([]);
  const [matrix, setMatrix] = useState<Matrix>({});
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Sprint 23, item 5. Its own error, not the panel's: a photo that failed to
  // upload must not clear the message about the salary row that did not save.
  const photoInput = useRef<HTMLInputElement>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [staffPayload, salaryPayload] = await Promise.all([
        schoolFetch<{ staff: StaffDetail; account: LinkedAccount | null }>(
          `/api/school/hr/staff/${staffId}`,
        ),
        schoolFetch<{ structure: StructureRow[]; components: ComponentRow[] }>(
          `/api/school/hr/staff/${staffId}/salary`,
        ),
      ]);

      setDetail(staffPayload.staff);
      setAccount(staffPayload.account);
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

  /*
   * The photograph, uploaded through the server — Sprint 23, item 5.
   *
   * A raw `fetch` with `FormData` rather than `schoolFetch`, exactly as
   * `StudentProfileCard` does it: `schoolFetch` sets a JSON content type, and a
   * multipart body needs the browser to set its own boundary. `withSchoolParam`
   * is what carries the tenant on a platform-session preview, so it is applied
   * by hand here instead.
   */
  const uploadPhoto = async (file: File): Promise<void> => {
    setPhotoBusy(true);
    setPhotoError(null);

    try {
      const body = new FormData();
      body.append('photo', file);

      const response = await fetch(
        withSchoolParam(`/api/school/hr/staff/${staffId}/photo`),
        { method: 'POST', body },
      );

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;

        setPhotoError(
          payload?.error?.message ??
            `The photo could not be uploaded (HTTP ${String(response.status)}).`,
        );
        return;
      }

      await load();
    } catch (caught) {
      setPhotoError(schoolErrorMessage(caught, 'The photo could not be uploaded.'));
    } finally {
      setPhotoBusy(false);
      // Cleared so selecting the *same* file again still fires `change`.
      if (photoInput.current !== null) photoInput.current.value = '';
    }
  };

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

  /**
   * The link picker's candidates, fetched when the picker is opened.
   *
   * Never on mount: most people arrive at this screen to change a salary head,
   * and reading the user directory to answer a question nobody asked is a
   * request a school pays for on every visit.
   */
  const loadAccounts = useCallback(async () => {
    setAccountsPending(true);
    try {
      const payload = await schoolFetch<{ accounts: PortalAccountOption[] }>(
        '/api/school/hr/staff/portal-accounts',
      );
      setAccounts(payload.accounts);
    } catch (caught) {
      setAccounts([]);
      setError(schoolErrorMessage(caught, 'Could not load portal accounts.'));
    } finally {
      setAccountsPending(false);
    }
  }, []);

  const linkAccount = async (): Promise<void> => {
    if (linkChoice === '') {
      setError('Choose an account to link.');
      return;
    }

    setBusy('link');
    setError(null);
    setNotice(null);

    try {
      await schoolFetch(`/api/school/hr/staff/${staffId}/portal-access`, {
        method: 'POST',
        body: JSON.stringify({ mode: 'link', schoolUserId: linkChoice }),
      });
      setNotice('Linked. The two records are now one person.');
      setPortalPanel('closed');
      setLinkChoice('');
      setAccounts(null);
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not link that account.'));
    } finally {
      setBusy(null);
    }
  };

  const createLogin = async (): Promise<void> => {
    if (loginRole === '') {
      setError('Choose the role the login is created with.');
      return;
    }

    setBusy('create-login');
    setError(null);
    setNotice(null);

    try {
      const payload = await schoolFetch<{
        portalAccess: { linked: true; schoolUserId: string; delivery: AccessDelivery | null };
      }>(`/api/school/hr/staff/${staffId}/portal-access`, {
        method: 'POST',
        body: JSON.stringify({
          mode: 'create',
          role: loginRole,
          branchId: loginBranchId === '' ? undefined : loginBranchId,
        }),
      });

      // Queued, never sent — the message leaves `email_outbox` moments from
      // now. Saying "sent" here would be a claim nobody checked.
      const delivery = payload.portalAccess.delivery;
      setNotice(
        delivery !== null && !delivery.queued
          ? `The login was created, but no password-setup email was queued. ${delivery.reason} Send it again from their profile.`
          : 'Login created. A link to set a password has been queued to their address.',
      );

      setPortalPanel('closed');
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not create the login.'));
    } finally {
      setBusy(null);
    }
  };

  const unlinkAccount = async (): Promise<void> => {
    setBusy('unlink');
    setError(null);
    setNotice(null);

    try {
      await schoolFetch(`/api/school/hr/staff/${staffId}/portal-access`, {
        method: 'DELETE',
      });
      setNotice('Unlinked. Both records are intact; only the link was removed.');
      setAccounts(null);
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not unlink that account.'));
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
        {/*
          The photograph — Sprint 23, item 5.

          `Avatar` rather than a bare `<img>`, so a member of staff with no
          photograph gets the initials that are already drawn everywhere else in
          this product. There is deliberately no placeholder silhouette: a grey
          outline of a person tells the reader nothing and looks like a broken
          image, whereas two letters are the person's own.

          Gated on `canEdit` (`hr.write`) — the same permission that saves every
          other field on this card, and the same one the route checks again.
        */}
        <div className="mb-6 flex items-center gap-4">
          <Avatar name={detail.fullName} src={detail.photoUrl} size="lg" />

          {canEdit ? (
            <div>
              <input
                ref={photoInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file !== undefined) void uploadPhoto(file);
                }}
              />
              <button
                type="button"
                disabled={photoBusy}
                className="text-sm font-medium text-brand-primary hover:underline disabled:text-ink-muted"
                onClick={() => {
                  photoInput.current?.click();
                }}
              >
                {photoBusy
                  ? 'Uploading…'
                  : detail.photoUrl === null || detail.photoUrl === ''
                    ? 'Add photo'
                    : 'Change photo'}
              </button>
              <p className="mt-0.5 text-xs text-ink-muted">PNG, JPG or WebP, up to 2 MB.</p>
              {photoError === null ? null : (
                <p role="alert" className="mt-1 text-xs text-status-danger-ink">
                  {photoError}
                </p>
              )}
            </div>
          ) : null}
        </div>

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
          {/* Sprint 23, item 8. The same ceiling the create form carries and
              the same one `PATCH /api/school/hr/staff/[staffId]` enforces. */}
          <Input
            label="Joining date"
            type="date"
            max={maxJoiningDate()}
            hint="At most one year from today. A past date is fine."
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
          {/*
            The same field the admissions desk uses — masked, revealed
            deliberately, and reformatted to 5-7-1 as it is typed. A staff CNIC
            is a national identity number on a screen in a shared office for
            exactly the same reason a guardian's is.
          */}
          <CnicField
            value={form.cnic ?? ''}
            disabled={!canEdit}
            onChange={(value) => {
              setField('cnic', value);
            }}
          />
          <Input
            label="Date of birth"
            type="date"
            hint={DATE_INPUT_HINT}
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

      {/*
        ── Portal access ────────────────────────────────────────────────
        The two halves of one person, and the row that says whether they have
        met. Advisory throughout: nothing here changes what any other screen
        permits, and the record saves with or without it.
      */}
      <Card
        header={
          <CardTitle
            title="Portal access"
            description="Whether this person can sign in, and which account is theirs."
            action={
              account === null ? (
                <Badge variant="warning">No login</Badge>
              ) : (
                <Badge variant="success">Linked</Badge>
              )
            }
          />
        }
      >
        {account !== null ? (
          <div className="space-y-3">
            <dl className="grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-xs uppercase tracking-wide text-ink-muted">Account</dt>
                <dd className="mt-1 text-sm text-ink">
                  <Link
                    href={`/dashboard/users/${account.id}`}
                    className="font-medium text-brand-primary hover:underline"
                  >
                    {account.name}
                  </Link>
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-ink-muted">Role</dt>
                <dd className="mt-1 text-sm text-ink">
                  {isUserRole(account.role) ? ROLE_LABELS[account.role] : account.role}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-ink-muted">Branch</dt>
                <dd className="mt-1 text-sm text-ink">
                  {account.branchName ?? 'All branches'}
                </dd>
              </div>
            </dl>

            {canEdit ? (
              <Button
                variant="secondary"
                size="sm"
                isLoading={busy === 'unlink'}
                onClick={() => {
                  void unlinkAccount();
                }}
              >
                Unlink
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-ink-muted">
              This employment record has no portal account, so this person
              cannot sign in.
              {/*
                The consequence, stated only where it is one. A class teacher
                with no login is the case the sprint was opened for: the class
                can name them, and no timetable can give them a period.
              */}
              {detail.isClassTeacher
                ? ' They are marked as a class teacher and cannot be assigned periods without a portal login.'
                : ''}
            </p>

            {canEdit && portalPanel === 'closed' ? (
              <div className="flex flex-wrap gap-3">
                {canSeeAccounts ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setPortalPanel('link');
                      if (accounts === null && !accountsPending) void loadAccounts();
                    }}
                  >
                    Link an existing account
                  </Button>
                ) : null}
                {canCreateLogin ? (
                  <Button
                    size="sm"
                    onClick={() => {
                      setPortalPanel('create');
                      setLoginBranchId(detail.branchId ?? '');
                    }}
                  >
                    Create a login
                  </Button>
                ) : null}
              </div>
            ) : null}

            {portalPanel === 'link' ? (
              <div className="space-y-3">
                {accountsPending ? (
                  <p className="text-sm text-ink-muted">Loading portal accounts…</p>
                ) : (accounts ?? []).length === 0 ? (
                  <p className="text-sm text-ink-muted">
                    Every active account at this school already has an employment
                    record. Create a login instead.
                  </p>
                ) : (
                  <Select
                    label="Portal account"
                    placeholder="Select an account"
                    options={(accounts ?? []).map((option) => ({
                      value: option.id,
                      label: `${option.name} — ${
                        isUserRole(option.role) ? ROLE_LABELS[option.role] : option.role
                      }${option.branchName === null ? '' : ` · ${option.branchName}`}`,
                    }))}
                    value={linkChoice}
                    onChange={(event) => {
                      setLinkChoice(event.target.value);
                    }}
                  />
                )}

                <div className="flex gap-3">
                  <Button
                    size="sm"
                    isLoading={busy === 'link'}
                    disabled={(accounts ?? []).length === 0}
                    onClick={() => {
                      void linkAccount();
                    }}
                  >
                    Link
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setPortalPanel('closed');
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}

            {portalPanel === 'create' ? (
              <div className="space-y-3">
                <p className="text-sm text-ink-muted">
                  The login is created against the email address and phone number
                  on this record — {detail.email ?? 'no address on file'} and{' '}
                  {detail.phone ?? 'no number on file'}. Correct them above first
                  if either is wrong; the address is the identity the account is
                  keyed by.
                </p>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Select
                    label="Role"
                    placeholder="Select a role"
                    options={ROLE_OPTIONS}
                    value={loginRole}
                    onChange={(event) => {
                      setLoginRole(event.target.value);
                    }}
                  />
                  {BRANCH_REQUIRED_ROLES.includes(
                    loginRole as (typeof INVITABLE_ROLES)[number],
                  ) ? (
                    <Select
                      label="Branch"
                      options={[
                        { value: '', label: 'Select a branch' },
                        ...branches.map((branch) => ({
                          value: branch.id,
                          label: branch.name,
                        })),
                      ]}
                      value={loginBranchId}
                      hint="Required for this role."
                      onChange={(event) => {
                        setLoginBranchId(event.target.value);
                      }}
                    />
                  ) : null}
                </div>

                <div className="flex gap-3">
                  <Button
                    size="sm"
                    isLoading={busy === 'create-login'}
                    onClick={() => {
                      void createLogin();
                    }}
                  >
                    Create login
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setPortalPanel('closed');
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        )}
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
