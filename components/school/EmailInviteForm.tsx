'use client';

import { useCallback, useState, type FormEvent, type ReactNode } from 'react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';
import {
  BRANCH_REQUIRED_ROLES,
  INVITABLE_ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  isUserRole,
} from '@/types/school-auth';

export interface BranchOption {
  id: string;
  name: string;
}

export interface EmailInviteFormProps {
  branches: readonly BranchOption[];
  /** Called after a successful send, with the address it went to. */
  onSent: (email: string) => void;
  /** Rendered beside "Send invitation" — a Cancel button in the modal. */
  secondaryAction?: ReactNode;
}

/**
 * The invite form: email address, name, role, branch.
 *
 * Shared by the modal on the users list and the standalone
 * /dashboard/users/invite page, so there is one implementation of what an
 * invitation asks for and one place it posts to.
 *
 * There is no phone field. This invitation travels by email and nothing in the
 * flow can reach a phone number, so asking for one would only imply otherwise.
 * The WhatsApp form that did ask for it is `components/school/InviteForm.tsx`,
 * kept intact and unrendered — see the note at the bottom of this file.
 *
 * Administrative roles are offered but not first. The default is Teacher
 * because that is what almost every invitation is, and a select whose first
 * option grants full access is one mis-click away from a problem nobody
 * notices for a week.
 */
export function EmailInviteForm({
  branches,
  onSent,
  secondaryAction,
}: EmailInviteFormProps) {
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [role, setRole] = useState<string>('teacher');
  const [branchId, setBranchId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const branchRequired = isUserRole(role) && BRANCH_REQUIRED_ROLES.includes(role);

  const submit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError(null);

      if (email.trim() === '') {
        setError('Enter an email address.');
        return;
      }
      if (firstName.trim() === '') {
        setError('Enter a first name.');
        return;
      }
      if (branchRequired && branchId === '') {
        setError('This role must be assigned to a branch.');
        return;
      }

      setIsLoading(true);

      try {
        await schoolFetch<{ message: string }>('/api/school/users/invite', {
          method: 'POST',
          body: JSON.stringify({
            email: email.trim(),
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            role,
            branchId: branchId === '' ? null : branchId,
          }),
        });

        onSent(email.trim());
      } catch (caught) {
        setError(schoolErrorMessage(caught, 'Could not send the invitation.'));
        setIsLoading(false);
      }
    },
    [email, firstName, lastName, role, branchId, branchRequired, onSent],
  );

  return (
    <form
      onSubmit={(event) => {
        void submit(event);
      }}
      noValidate
    >
      <div className="space-y-4 px-5 py-4">
        <Input
          label="Email address"
          name="email"
          type="email"
          inputMode="email"
          autoFocus
          required
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
          placeholder="colleague@school.edu.pk"
          hint="The invitation and every future sign-in code go here."
          disabled={isLoading}
        />

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="First name"
            name="firstName"
            required
            value={firstName}
            onChange={(event) => {
              setFirstName(event.target.value);
            }}
            disabled={isLoading}
          />

          <Input
            label="Last name"
            name="lastName"
            value={lastName}
            onChange={(event) => {
              setLastName(event.target.value);
            }}
            disabled={isLoading}
          />
        </div>

        <Select
          label="Role"
          name="role"
          value={role}
          options={INVITABLE_ROLES.map((option) => ({
            value: option,
            label: ROLE_LABELS[option],
          }))}
          onChange={(event) => {
            const next = event.target.value;
            setRole(next);
            // A role that does not take a branch must not carry one over from
            // the role that was selected a moment ago.
            if (!(isUserRole(next) && BRANCH_REQUIRED_ROLES.includes(next))) {
              setBranchId('');
            }
          }}
          hint={isUserRole(role) ? ROLE_DESCRIPTIONS[role] : undefined}
          disabled={isLoading}
        />

        {branches.length > 0 ? (
          <Select
            label={branchRequired ? 'Branch' : 'Branch (optional)'}
            name="branchId"
            value={branchId}
            // `placeholder` renders a *disabled* option, which is right for a
            // required choice and wrong for an optional one — it would make
            // "All branches" unreachable once a branch was picked.
            {...(branchRequired ? { placeholder: 'Select a branch' } : {})}
            options={[
              ...(branchRequired ? [] : [{ value: '', label: 'All branches' }]),
              ...branches.map((branch) => ({
                value: branch.id,
                label: branch.name,
              })),
            ]}
            onChange={(event) => {
              setBranchId(event.target.value);
            }}
            disabled={isLoading}
          />
        ) : null}

        {error !== null ? (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
      </div>

      <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
        {secondaryAction}
        <Button type="submit" isLoading={isLoading}>
          Send invitation
        </Button>
      </div>
    </form>
  );
}

/* WHATSAPP_DISABLED_START */
// WhatsApp auth temporarily disabled - re-enable when Meta template approved
//
// The phone-based invite form this replaces is `components/school/InviteForm.tsx`,
// untouched and still exported. It posts to `/api/school/invitations`, whose
// POST handler is disabled for the same reason. To bring both back: restore
// that route, then render <InviteForm /> from
// `app/(school-admin)/dashboard/users/invite/page.tsx` again — most likely
// beside this one rather than instead of it, since a school with email
// invitations still has parents who only read WhatsApp.
/* WHATSAPP_DISABLED_END */
