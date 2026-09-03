'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { PhoneField } from '@/components/ui/PhoneField';
import { Select } from '@/components/ui/Select';
import { maxJoiningDate } from '@/lib/dates';
import { isValidEmail } from '@/lib/password-strength';
import {
  BRANCH_REQUIRED_ROLES,
  INVITABLE_ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  isUserRole,
  type UserRole,
} from '@/types/school-auth';

export interface InviteFormBranch {
  id: string;
  name: string;
}

export interface InviteFormProps {
  branches: readonly InviteFormBranch[];
  /**
   * `hr.write` — whether this person may also file an employment record.
   *
   * Absent, not disabled, for somebody who holds only `users.write`. A section
   * that is visibly there and permanently greyed teaches the operator that the
   * product is broken; the server checks the key again in any case.
   */
  canAddEmployment: boolean;
}

/**
 * What the route answers with since Sprint 17.
 *
 * `delivery` is `queueAccessEmail`'s own result, not a list of transport
 * failures: the member is created either way, and what this screen has to say
 * is whether the password-setup mail was queued and, when it was not, the one
 * sentence that says why. "Invited" over a message nobody queued is the failure
 * this shape exists to make impossible to render.
 */
interface InviteResponse {
  ok: boolean;
  data?: {
    user: { id: string; name: string };
    delivery:
      | { queued: true; firstTime: boolean; email: string }
      | { queued: false; reason: string };
    /**
     * The second half, when one was asked for — Sprint 22.
     *
     * The account is this screen's point, so it is written first and never
     * rolled back. A failed employment insert leaves the member invited and
     * says so, naming the field: the only collision that can happen here is an
     * employee code somebody else already uses, and typing a different one is
     * the only thing anybody can do about it.
     */
    employment: { created: true; staffId: string } | { created: false; problem: string } | null;
  };
  error?: { message: string };
}

// Students and parents are absent on purpose: those accounts come from the
// admissions flow alongside a student record, and a bare "student" invite
// produces a login that can see nothing.
const ROLE_OPTIONS = INVITABLE_ROLES.map((role) => ({
  value: role,
  label: ROLE_LABELS[role],
}));

/** Roles normally created by Admissions rather than invited by hand. */
const ADMISSIONS_ROLES: readonly UserRole[] = ['student', 'parent'];

export function InviteForm({ branches, canAddEmployment }: InviteFormProps) {
  const router = useRouter();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('');
  const [branchId, setBranchId] = useState('');

  /*
   * Default **on** for every invitable role, because all nine of them are
   * staff. A teacher invited without an employment record can be timetabled
   * and can never be a class teacher, and until this sprint nothing on this
   * screen said so.
   */
  const [addEmployment, setAddEmployment] = useState(canAddEmployment);
  const [employeeCode, setEmployeeCode] = useState('');
  const [codePending, setCodePending] = useState(canAddEmployment);
  const [designation, setDesignation] = useState('');
  const [department, setDepartment] = useState('');
  const [joinedOn, setJoinedOn] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  /*
   * The proposed employee code, fetched once.
   *
   * `staff.employee_code` is NOT NULL and unique per school with no generator,
   * and the person filling in this form is inviting a colleague — they have no
   * idea what the school's numbering looks like. So the server proposes and the
   * field stays editable. A proposal, not a reservation: two administrators on
   * the same minute are offered the same number and the second meets the unique
   * index, reported against this field.
   */
  useEffect(() => {
    if (!canAddEmployment) return;

    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch('/api/school/hr/staff/next-code');
        const payload = (await response.json()) as {
          ok: boolean;
          data?: { employeeCode: string };
        };

        if (!cancelled && response.ok && payload.ok && payload.data !== undefined) {
          setEmployeeCode(payload.data.employeeCode);
        }
      } catch {
        // A proposal that could not be fetched is not a failure of this screen:
        // the field is editable and the school has its own codes. Silence here,
        // and the placeholder says what the shape is.
      } finally {
        if (!cancelled) setCodePending(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canAddEmployment]);

  /**
   * Designation follows the role, until somebody types something (Sprint 23,
   * item 6).
   *
   * It is a *default*, not a constraint — the field stays free text, because
   * "Senior Physics Teacher" is what a contract says and "Teacher" is not.
   *
   * The second clause is what makes changing the role twice behave. Overwriting
   * only a blank field would leave "Teacher" in place after the operator
   * corrects the role to Accountant, and overwriting unconditionally would
   * throw away a title somebody had just typed. So it is overwritten when it is
   * blank **or** when it still holds the label of the role being replaced, and
   * left alone in every other case.
   */
  const defaultDesignationFor = (nextRole: string): void => {
    if (!isUserRole(nextRole)) return;

    setDesignation((current) => {
      const typed = current.trim();
      if (typed === '') return ROLE_LABELS[nextRole];

      const isPreviousLabel = INVITABLE_ROLES.some(
        (candidate) => ROLE_LABELS[candidate] === typed,
      );
      return isPreviousLabel ? ROLE_LABELS[nextRole] : current;
    });
  };

  const selectedRole = isUserRole(role) ? role : null;
  const branchRequired = selectedRole !== null && BRANCH_REQUIRED_ROLES.includes(selectedRole);
  const showAdmissionsNotice = selectedRole !== null && ADMISSIONS_ROLES.includes(selectedRole);
  const fileEmployment = canAddEmployment && addEmployment;

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError(null);
      setWarning(null);

      if (name.trim() === '') {
        setError('Enter the person’s full name.');
        return;
      }
      if (phone.trim() === '') {
        // Required because `school_users.phone` is NOT NULL and unique per
        // school, not because anything is sent to it. Nothing is: the
        // invitation and every sign-in code go to the address below.
        setError('A phone number is required — it is part of this member’s record.');
        return;
      }
      if (!isValidEmail(email.trim())) {
        setError('An email address is required — it is what the account is created against.');
        return;
      }
      if (selectedRole === null) {
        setError('Select a role.');
        return;
      }
      if (branchRequired && branchId === '') {
        setError('This role must be assigned to a branch.');
        return;
      }
      if (fileEmployment && employeeCode.trim() === '') {
        setError('Give the employment record an employee code.');
        return;
      }

      setIsSubmitting(true);

      try {
        const response = await fetch('/api/school/invitations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            phone: phone.trim(),
            email: email.trim(),
            role: selectedRole,
            branchId: branchId === '' ? undefined : branchId,
            // Absent, not `null`, when the box is clear — the route reads the
            // key's presence as the request, so an old client is unaffected.
            employment: fileEmployment
              ? {
                  employeeCode: employeeCode.trim(),
                  designation: designation.trim(),
                  department: department.trim(),
                  joinedOn: joinedOn === '' ? null : joinedOn,
                }
              : undefined,
          }),
        });

        const payload = (await response.json()) as InviteResponse;

        if (!response.ok || payload.ok !== true) {
          setError(payload.error?.message ?? 'The invitation could not be sent.');
          setIsSubmitting(false);
          return;
        }

        /*
         * "Queued" rather than "sent": the mail goes through `email_outbox`
         * and is handed to SMTP a moment later, so at this point nothing has
         * been accepted by a mail server and this screen cannot claim it has.
         *
         * A member whose mail was *not* queued still exists, and saying so is
         * the whole point of carrying the reason back — the account is
         * reachable again from **Send access email** on their profile, and an
         * administrator who is not told will simply assume it arrived.
         */
        const delivery = payload.data?.delivery;
        if (delivery !== undefined && !delivery.queued) {
          setWarning(
            `${name.trim()} was added, but no password-setup email was queued. ${delivery.reason}`,
          );
          setIsSubmitting(false);
          return;
        }

        /*
         * The employment half, reported the same way and for the same reason.
         * The invitation went; the record did not. Leaving on the success path
         * would say the opposite by omission, and the only fix — a different
         * employee code — is on this form.
         */
        const employment = payload.data?.employment;
        if (employment != null && !employment.created) {
          setWarning(`${name.trim()} was invited. ${employment.problem}`);
          setIsSubmitting(false);
          return;
        }

        router.push('/dashboard/users');
        router.refresh();
      } catch {
        setError('The invitation could not be sent. Please try again.');
        setIsSubmitting(false);
      }
    },
    [
      name,
      phone,
      email,
      selectedRole,
      branchRequired,
      branchId,
      fileEmployment,
      employeeCode,
      designation,
      department,
      joinedOn,
      router,
    ],
  );

  const branchOptions = [
    { value: '', label: branchRequired ? 'Select a branch' : 'All branches' },
    ...branches.map((branch) => ({ value: branch.id, label: branch.name })),
  ];

  return (
    <form
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
      className="space-y-6"
      noValidate
    >
      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Input
              label="Full name"
              required
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
              disabled={isSubmitting}
            />
          </div>

          {/*
            Deliberately NOT `identity`.

            It was, and that was wrong twice over. `identity` refuses a
            landline with "this number identifies the person on the platform,
            so it has to be a mobile — invitations and sign-in codes are sent
            to it", and neither half of that sentence is true: the account is
            keyed by the email address and nothing is sent to this number. A
            school office whose only number for a new bursar was the desk
            landline could not complete the form at all.
          */}
          <PhoneField
            label="Phone number"
            required
            value={phone}
            onChange={setPhone}
            hint="A contact number for the school’s own records. Mobile or landline."
            disabled={isSubmitting}
          />

          <Input
            label="Email"
            type="email"
            required
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
            hint="They sign in with this address, and the invitation goes here."
            disabled={isSubmitting}
          />

          <Select
            label="Role"
            options={ROLE_OPTIONS}
            placeholder="Select a role"
            required
            value={role}
            // What a role may actually do is per school, so the one-liner is
            // the honest summary rather than a promise about specific screens.
            hint={
              selectedRole === null
                ? 'What each role may do is set under Settings → Permissions.'
                : ROLE_DESCRIPTIONS[selectedRole]
            }
            onChange={(event) => {
              setRole(event.target.value);
              defaultDesignationFor(event.target.value);
            }}
            disabled={isSubmitting}
          />

          <Select
            label="Branch"
            options={branchOptions}
            value={branchId}
            required={branchRequired}
            onChange={(event) => {
              setBranchId(event.target.value);
            }}
            hint={branchRequired ? 'Required for this role.' : 'Optional for this role.'}
            disabled={isSubmitting}
          />

          {showAdmissionsNotice ? (
            <div className="sm:col-span-2">
              <p className="rounded-lg bg-status-warning-subtle px-3 py-2 text-sm text-status-warning-onSubtle">
                These accounts are typically created via the Admissions module.
                You can still invite manually here.
              </p>
            </div>
          ) : null}
        </div>
      </Card>

      {/*
        ── The employment record ────────────────────────────────────────
        A member of staff could exist twice in this product and the two halves
        never met: `timetable_entries.teacher_id` points at the account this
        form creates, and `sections.class_teacher_id` points at an employment
        record only HR could file. Same person, two rows, and nothing joined
        them. This box joins them, and it is ticked by default because every
        role this form offers is a member of staff.
      */}
      {canAddEmployment ? (
        <Card>
          <label className="flex items-start gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="mt-1"
              checked={addEmployment}
              disabled={isSubmitting}
              onChange={(event) => {
                setAddEmployment(event.target.checked);
              }}
            />
            <span>
              Also add an employment record
              <span className="block text-xs text-ink-muted">
                Puts them on the HR staff list, which is what a class names as
                its class teacher and what payroll pays. Clear this for somebody
                who only needs a login.
              </span>
            </span>
          </label>

          {fileEmployment ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Input
                label="Employee code"
                required
                value={employeeCode}
                maxLength={32}
                placeholder="EMP-001"
                // Proposed by the server and editable. Pending until it lands,
                // so nobody types over a value that is about to arrive.
                disabled={isSubmitting || codePending}
                hint={
                  codePending
                    ? 'Looking up the next free code…'
                    : 'Unique at this school. Edit it if your numbering differs.'
                }
                onChange={(event) => {
                  setEmployeeCode(event.target.value);
                }}
              />
              <Input
                label="Designation"
                value={designation}
                placeholder="Senior Physics Teacher"
                disabled={isSubmitting}
                onChange={(event) => {
                  setDesignation(event.target.value);
                }}
              />
              <Input
                label="Department"
                value={department}
                placeholder="Science"
                disabled={isSubmitting}
                onChange={(event) => {
                  setDepartment(event.target.value);
                }}
              />
              {/* Sprint 23, item 8. `POST /api/school/invitations` refuses the
                  same date; this is the courtesy that stops it being typed. */}
              <Input
                label="Joining date"
                type="date"
                max={maxJoiningDate()}
                hint="At most one year from today. A past date is fine."
                value={joinedOn}
                disabled={isSubmitting}
                onChange={(event) => {
                  setJoinedOn(event.target.value);
                }}
              />
            </div>
          ) : null}
        </Card>
      ) : null}

      {error !== null ? (
        <p role="alert" className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}

      {warning !== null ? (
        <p className="rounded-lg bg-status-warning-subtle px-3 py-2 text-sm text-status-warning-onSubtle">{warning}</p>
      ) : null}

      <div className="flex gap-3">
        <Button type="submit" isLoading={isSubmitting}>
          Send invitation
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={isSubmitting}
          onClick={() => {
            router.back();
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
