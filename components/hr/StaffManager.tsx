'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { Avatar } from '@/components/ui/Avatar';
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
import { maxJoiningDate } from '@/lib/dates';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';
import {
  BRANCH_REQUIRED_ROLES,
  INVITABLE_ROLES,
  ROLE_LABELS,
  isUserRole,
} from '@/types/school-auth';

/**
 * The staff directory, with the form that adds to it.
 *
 * Only the fields a school cannot proceed without are on the create form —
 * code, name, designation, joining date. Everything else (identity, bank, next
 * of kin) is on the detail screen, because a school entering forty staff at
 * setup should not have to complete forty long forms before payroll can be
 * configured at all.
 *
 * ── Portal access, Sprint 22 ─────────────────────────────────────────────
 * A member of staff could exist twice in this product — once here and once in
 * Users & Staff — and nothing joined the two. A teacher needs both rows:
 * `timetable_entries.teacher_id` points at the account, and
 * `sections.class_teacher_id` points at the employment record. So this form
 * asks, once, and **"No login needed" is the default and stays the default**.
 * A driver is on the payroll and never signs in.
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
  /** Null on every row in the product before this sprint. */
  schoolUserId: string | null;
  /** The personnel photograph, or null (Sprint 23, item 5). */
  photoUrl: string | null;
}

interface PortalAccountOption {
  id: string;
  name: string;
  role: string;
  phone: string;
  email: string | null;
  branchName: string | null;
}

/** What the POST answers about the second half of the job. */
type PortalAccessOutcome =
  | { linked: true; schoolUserId: string; delivery: AccessDelivery | null }
  | { linked: false; problem: string };

type AccessDelivery =
  | { queued: true; firstTime: boolean; email: string }
  | { queued: false; reason: string };

export interface StaffManagerProps {
  canEdit: boolean;
  /** `users.write` — whether this person may mint a login from here at all. */
  canCreateLogin: boolean;
  /** `users.read` — whether the link picker may be offered. */
  canSeeAccounts: boolean;
  branches: ReadonlyArray<{ id: string; name: string }>;
}

/** Mirrors the three modes `POST /api/school/hr/staff` accepts. */
type PortalMode = 'none' | 'create' | 'link';

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
  portalMode: PortalMode;
  portalRole: string;
  portalBranchId: string;
  portalSchoolUserId: string;
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
  /*
   * The default that must not move. Most of a school's payroll never signs in,
   * and a form that opened on "Create a login" would either mint accounts
   * nobody wanted or make the clerk clear a field on every single record.
   */
  portalMode: 'none',
  portalRole: '',
  portalBranchId: '',
  portalSchoolUserId: '',
};

const PORTAL_MODES: ReadonlyArray<{
  value: PortalMode;
  label: string;
  hint: string;
}> = [
  {
    value: 'none',
    label: 'No login needed',
    hint: 'On the payroll, never signs in — a driver, a cleaner, a guard.',
  },
  {
    value: 'create',
    label: 'Create a login',
    hint: 'Adds a portal account and emails them a link to set a password.',
  },
  {
    value: 'link',
    label: 'Link an existing account',
    hint: 'They were already invited from Users & Staff.',
  },
];

const ROLE_OPTIONS = INVITABLE_ROLES.map((role) => ({
  value: role,
  label: ROLE_LABELS[role],
}));

export function StaffManager({
  canEdit,
  canCreateLogin,
  canSeeAccounts,
  branches,
}: StaffManagerProps) {
  const [rows, setRows] = useState<StaffRow[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [accounts, setAccounts] = useState<PortalAccountOption[] | null>(null);
  const [accountsPending, setAccountsPending] = useState(false);

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

  /**
   * The link picker's candidates, fetched the first time the mode is chosen.
   *
   * Not on mount: most records are added with no login at all, and a directory
   * read on every visit to this screen would be a request nobody asked for.
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

  const setPortalMode = (current: Draft, mode: PortalMode): void => {
    setDraft({ ...current, portalMode: mode });
    if (mode === 'link' && accounts === null && !accountsPending) {
      void loadAccounts();
    }
  };

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

    /*
     * Checked here as well as on the server, and the reason is on screen beside
     * the fields: under Supabase Auth the address *is* the identity the account
     * is keyed by, and `school_users.phone` is NOT NULL and unique per school.
     * Neither is true of an employment record, which is why "No login needed"
     * asks for neither.
     */
    if (draft.portalMode === 'create') {
      if (draft.portalRole === '') {
        setError('Choose the role the login is created with.');
        return;
      }
      if (draft.email.trim() === '' || draft.phone.trim() === '') {
        setError(
          'A login needs both an email address and a phone number — the address is what the account is keyed by, and the number is part of the directory record.',
        );
        return;
      }
      if (
        BRANCH_REQUIRED_ROLES.includes(draft.portalRole as (typeof INVITABLE_ROLES)[number]) &&
        draft.portalBranchId === ''
      ) {
        setError('That role must be assigned to a branch.');
        return;
      }
    }

    if (draft.portalMode === 'link' && draft.portalSchoolUserId === '') {
      setError('Choose the portal account to link, or select “No login needed”.');
      return;
    }

    setBusy('save');
    setError(null);
    setWarning(null);

    try {
      const payload = await schoolFetch<{
        staffId: string;
        portalAccess: PortalAccessOutcome | null;
      }>('/api/school/hr/staff', {
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
          portalAccess: {
            mode: draft.portalMode,
            role: draft.portalRole === '' ? undefined : draft.portalRole,
            branchId: draft.portalBranchId === '' ? undefined : draft.portalBranchId,
            schoolUserId:
              draft.portalSchoolUserId === '' ? undefined : draft.portalSchoolUserId,
          },
        }),
      });

      /*
       * The employment record is saved by the time this runs and stays saved.
       * What is reported here is the *second* half — see the route's docblock —
       * and it is reported rather than assumed for the same reason `InviteForm`
       * reports the delivery: "Staff member added" over a login that was never
       * created, or a message nobody queued, is the failure this shape exists
       * to prevent.
       */
      const outcome = payload.portalAccess;
      if (outcome !== null && !outcome.linked) {
        setWarning(
          `${draft.firstName.trim()} ${draft.lastName.trim()} was added to the payroll, but no login was created. ${outcome.problem} You can link or create one from their profile.`,
        );
      } else if (outcome !== null && outcome.delivery !== null && !outcome.delivery.queued) {
        setWarning(
          `The staff member and the login were created, but no password-setup email was queued. ${outcome.delivery.reason} Send it again from their profile.`,
        );
      }

      setDraft(null);
      // The picker's candidates are now one shorter, or one longer.
      setAccounts(null);
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
        // Sprint 23, item 5. The photograph rides on the list row rather than
        // being fetched per person: forty requests to draw one screen is the
        // shape this product spends its whole loader budget avoiding. Nobody
        // without a photograph gets a silhouette — `Avatar` draws their
        // initials, which is what it already does everywhere else.
        <div className="flex items-center gap-3">
          <Avatar name={row.fullName} src={row.photoUrl} size="sm" />
          <div className="min-w-0">
            <p className="font-medium text-ink">{row.fullName}</p>
            {row.department === null ? null : (
              <p className="text-xs text-ink-muted">{row.department}</p>
            )}
          </div>
        </div>
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
        <div className="flex flex-wrap items-center gap-1">
          <Badge variant={STATUS_VARIANT[row.status]}>
            {STAFF_STATUS_LABELS[row.status]}
          </Badge>
          {/*
            Advisory, and nothing about it changes what any screen permits.
            Only on an *active* record: a resigned driver has no login and
            never needed one, and badging him would bury the four people the
            school actually has to reconcile.
          */}
          {row.status === 'active' && row.schoolUserId === null ? (
            <Badge variant="warning">No login</Badge>
          ) : null}
        </div>
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

      {/*
        A warning, not an error: the employment record was written. This says
        what did *not* happen alongside it, which is the only thing the person
        at the keyboard still has to act on.
      */}
      {warning !== null ? (
        <p className="rounded-lg bg-status-warning-subtle px-3 py-2 text-sm text-status-warning-onSubtle">
          {warning}
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
            {/* Sprint 23, item 8. `max` is the courtesy — the server refuses
                the same date through `joiningDateProblem`, which is the rule. */}
            <Input
              label="Joining date"
              type="date"
              max={maxJoiningDate()}
              hint="At most one year from today. A past date is fine."
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

          {/*
            ── Portal access ──────────────────────────────────────────────
            Absent, not disabled, for somebody who holds neither `users.write`
            nor `users.read`: a control that is visibly there and permanently
            greyed teaches a clerk that the product is broken. The server
            enforces both keys again in any case.
          */}
          {canCreateLogin || canSeeAccounts ? (
            <fieldset className="mt-6 border-t border-line pt-4">
              <legend className="sr-only">Portal access</legend>
              <p className="text-sm font-medium text-ink">Portal access</p>
              <p className="mt-1 text-xs text-ink-muted">
                A teacher needs both records: the login is what a timetable
                assigns periods to, and this employment record is what a class
                names as its class teacher.
              </p>

              <div className="mt-3 space-y-2">
                {PORTAL_MODES.filter(
                  (option) =>
                    option.value === 'none' ||
                    (option.value === 'create' && canCreateLogin) ||
                    (option.value === 'link' && canSeeAccounts),
                ).map((option) => (
                  <label
                    key={option.value}
                    className="flex items-start gap-2 text-sm text-ink"
                  >
                    <input
                      type="radio"
                      name="portalMode"
                      className="mt-1"
                      checked={draft.portalMode === option.value}
                      onChange={() => {
                        setPortalMode(draft, option.value);
                      }}
                    />
                    <span>
                      {option.label}
                      <span className="block text-xs text-ink-muted">{option.hint}</span>
                    </span>
                  </label>
                ))}
              </div>

              {draft.portalMode === 'create' ? (
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Select
                    label="Role"
                    options={ROLE_OPTIONS}
                    placeholder="Select a role"
                    value={draft.portalRole}
                    onChange={(event) => {
                      setDraft({ ...draft, portalRole: event.target.value });
                    }}
                  />
                  {BRANCH_REQUIRED_ROLES.includes(
                    draft.portalRole as (typeof INVITABLE_ROLES)[number],
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
                      value={draft.portalBranchId}
                      hint="Required for this role."
                      onChange={(event) => {
                        setDraft({ ...draft, portalBranchId: event.target.value });
                      }}
                    />
                  ) : null}
                  <p className="text-xs text-ink-muted sm:col-span-2">
                    The Email and Phone above become required: the address is the
                    identity the account is keyed by, and a directory record
                    cannot be filed without a number. They are emailed a link to
                    set their own password.
                  </p>
                </div>
              ) : null}

              {draft.portalMode === 'link' ? (
                <div className="mt-4">
                  {accountsPending ? (
                    <p className="text-sm text-ink-muted">Loading portal accounts…</p>
                  ) : (accounts ?? []).length === 0 ? (
                    <p className="text-sm text-ink-muted">
                      Every active account at this school already has an
                      employment record. Choose “Create a login” instead.
                    </p>
                  ) : (
                    <Select
                      label="Portal account"
                      placeholder="Select an account"
                      options={(accounts ?? []).map((account) => ({
                        value: account.id,
                        label: `${account.name} — ${
                          isUserRole(account.role) ? ROLE_LABELS[account.role] : account.role
                        }${account.branchName === null ? '' : ` · ${account.branchName}`}`,
                      }))}
                      value={draft.portalSchoolUserId}
                      onChange={(event) => {
                        setDraft({ ...draft, portalSchoolUserId: event.target.value });
                      }}
                    />
                  )}
                </div>
              ) : null}
            </fieldset>
          ) : null}

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
          /*
           * The reconciliation filter — §5 of the sprint, and the only part of
           * it that helps a school that already has split records. It is off by
           * default and it is the same population the badge marks: employed
           * here, no portal account.
           *
           * Filtered in the browser rather than by a round trip, because this
           * whole list already arrives in one request (see `load`). The API
           * carries `?linked=none` for anything that is not this screen.
           */
          {
            id: 'linked',
            label: 'Portal access',
            allLabel: 'Any',
            options: [
              { value: 'none', label: 'Unlinked — no login' },
              { value: 'linked', label: 'Has a login' },
            ],
            /*
             * Three answers, not two.
             *
             * "Unlinked" is deliberately an *active-only* question — a resigned
             * record needs no login and is not badged for wanting one. But the
             * complement of that is not "has a login": written as
             * `… ? 'none' : 'linked'`, a resigned unlinked record fell through
             * to `'linked'` and was listed under *Has a login* while holding
             * none.
             *
             * So the two filters are answered independently and a record that
             * is neither returns null, which `matchesFilter` treats as matching
             * nothing (`components/ui/DataTable.tsx:341`).
             */
            rowValue: (row) => {
              if (row.schoolUserId !== null) return 'linked';
              return row.status === 'active' ? 'none' : null;
            },
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
