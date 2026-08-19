'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { PhoneField } from '@/components/ui/PhoneField';
import { Select } from '@/components/ui/Select';
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
}

interface InviteResponse {
  ok: boolean;
  data?: { delivery: { failures: string[] } };
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

export function InviteForm({ branches }: InviteFormProps) {
  const router = useRouter();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('');
  const [branchId, setBranchId] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedRole = isUserRole(role) ? role : null;
  const branchRequired = selectedRole !== null && BRANCH_REQUIRED_ROLES.includes(selectedRole);
  const showAdmissionsNotice = selectedRole !== null && ADMISSIONS_ROLES.includes(selectedRole);

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
        // Not "invitations are sent over WhatsApp" — they are sent by email,
        // and have been since Stage 4. The number is required because
        // `school_users.phone` is NOT NULL and unique per school: it is how a
        // member is identified within a tenant, whether or not anything is ever
        // sent to it.
        setError('A phone number is required — it identifies this member within the school.');
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
          }),
        });

        const payload = (await response.json()) as InviteResponse;

        if (!response.ok || payload.ok !== true) {
          setError(payload.error?.message ?? 'The invitation could not be sent.');
          setIsSubmitting(false);
          return;
        }

        // Accepted on at least one channel, but say so if the other failed —
        // an admin who thinks WhatsApp went out when it did not will wait.
        //
        // "Queued" rather than "sent": email now goes through `email_outbox`
        // and is handed to SMTP a moment later, so at this point nothing has
        // been accepted by a mail server and this screen cannot claim it has.
        const failures = payload.data?.delivery.failures ?? [];
        if (failures.length > 0) {
          setWarning(`Invitation queued, with issues: ${failures.join(' ')}`);
        }

        router.push('/dashboard/users');
        router.refresh();
      } catch {
        setError('The invitation could not be sent. Please try again.');
        setIsSubmitting(false);
      }
    },
    [name, phone, email, selectedRole, branchRequired, branchId, router],
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

          <PhoneField
            label="Phone number"
            required
            // Identity: `school_users.phone` is unique per school and is what
            // the invitation-accept route resolves the member by.
            identity
            value={phone}
            onChange={setPhone}
            hint="Identifies this member within the school."
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
