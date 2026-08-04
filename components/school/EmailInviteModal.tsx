'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

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

export interface EmailInviteModalProps {
  branches: readonly BranchOption[];
  /** Called after a successful send, so the pending list can refresh. */
  onSent: (email: string) => void;
  onClose: () => void;
}

/**
 * "Invite user" — email address, name, role.
 *
 * Administrative roles are offered but not first. The default is Teacher
 * because that is what almost every invitation is, and a select whose first
 * option grants full access is one mis-click away from a problem nobody
 * notices for a week.
 *
 * There is no phone field: this invitation travels by email, and asking for a
 * number that no part of this flow uses would only imply it does.
 */
export function EmailInviteModal({ branches, onSent, onClose }: EmailInviteModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [role, setRole] = useState<string>('teacher');
  const [branchId, setBranchId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Escape closes. Anything that covers the page has to be dismissible from
  // the keyboard, not only from the button in the corner.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

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
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center"
      onMouseDown={(event) => {
        // Only a click that both starts and ends on the backdrop closes — a
        // drag that ends outside a text selection should not discard the form.
        if (event.target === dialogRef.current) onClose();
      }}
      ref={dialogRef}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-user-title"
        className="w-full max-w-md rounded-card border border-slate-200 bg-white shadow-card"
      >
        <form
          onSubmit={(event) => {
            void submit(event);
          }}
          noValidate
        >
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 id="invite-user-title" className="text-base font-semibold text-slate-900">
              Invite a user
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              They receive an email with a link and a six-digit code, and choose their
              own password. The invitation is valid for 72 hours.
            </p>
          </div>

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
                setRole(event.target.value);
                if (!BRANCH_REQUIRED_ROLES.includes(event.target.value as never)) {
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
                placeholder={branchRequired ? 'Select a branch' : 'All branches'}
                options={branches.map((branch) => ({
                  value: branch.id,
                  label: branch.name,
                }))}
                onChange={(event) => {
                  setBranchId(event.target.value);
                }}
                disabled={isLoading}
              />
            ) : null}

            {error !== null ? (
              <p
                role="alert"
                className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
              >
                {error}
              </p>
            ) : null}
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
            <Button variant="secondary" onClick={onClose} disabled={isLoading}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isLoading}>
              Send invitation
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
