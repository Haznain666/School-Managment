'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Toggle } from '@/components/ui/Toggle';
import { BRANCH_REQUIRED_ROLES, ROLE_LABELS, USER_ROLES, isUserRole } from '@/types/school-auth';

export interface UserDetail {
  id: string;
  name: string;
  email: string | null;
  phone: string;
  role: string;
  branchId: string | null;
  branchName: string | null;
  isActive: boolean;
  joinedAt: string | null;
  createdAt: string;
}

export interface UserDetailPanelProps {
  user: UserDetail;
  branches: ReadonlyArray<{ id: string; name: string }>;
  /** Only school_admin and hr_manager may change anything here. */
  canEdit: boolean;
}

const ROLE_OPTIONS = USER_ROLES.map((role) => ({
  value: role,
  label: ROLE_LABELS[role],
}));

export function UserDetailPanel({ user, branches, canEdit }: UserDetailPanelProps) {
  const router = useRouter();

  const [name, setName] = useState(user.name);
  const [role, setRole] = useState(user.role);
  const [branchId, setBranchId] = useState(user.branchId ?? '');
  const [isActive, setIsActive] = useState(user.isActive);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isResending, setIsResending] = useState(false);

  const branchRequired = isUserRole(role) && BRANCH_REQUIRED_ROLES.includes(role);

  const save = useCallback(async () => {
    setError(null);
    setNotice(null);

    if (name.trim() === '') {
      setError('Name cannot be empty.');
      return;
    }
    if (branchRequired && branchId === '') {
      setError('This role must be assigned to a branch.');
      return;
    }

    setIsSaving(true);

    try {
      const response = await fetch(`/api/school/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          role,
          branchId: branchId === '' ? null : branchId,
          isActive,
        }),
      });

      const payload = (await response.json()) as {
        ok: boolean;
        error?: { message: string };
      };

      if (!response.ok || payload.ok !== true) {
        setError(payload.error?.message ?? 'Could not save changes.');
        return;
      }

      setNotice('Changes saved. The user will be signed out of existing sessions.');
      router.refresh();
    } catch {
      setError('Could not save changes.');
    } finally {
      setIsSaving(false);
    }
  }, [name, role, branchId, isActive, branchRequired, user.id, router]);

  const resendInvite = useCallback(async () => {
    setIsResending(true);
    setError(null);
    setNotice(null);

    try {
      // Re-inviting an unjoined member reuses the invitation flow rather than
      // creating a second account for the same phone number.
      const response = await fetch('/api/school/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: user.name,
          phone: user.phone,
          email: user.email ?? undefined,
          role: user.role,
          branchId: user.branchId ?? undefined,
        }),
      });

      const payload = (await response.json()) as {
        ok: boolean;
        error?: { message: string };
      };

      if (!response.ok || payload.ok !== true) {
        setError(payload.error?.message ?? 'Could not resend the invitation.');
        return;
      }

      setNotice('Invitation sent again.');
    } catch {
      setError('Could not resend the invitation.');
    } finally {
      setIsResending(false);
    }
  }, [user]);

  const branchOptions = [
    { value: '', label: branchRequired ? 'Select a branch' : 'All branches' },
    ...branches.map((branch) => ({ value: branch.id, label: branch.name })),
  ];

  return (
    <div className="space-y-6">
      <Card header={<CardTitle title="Profile" />}>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Phone</dt>
            <dd className="mt-1 font-mono text-sm text-slate-900">{user.phone}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Email</dt>
            <dd className="mt-1 text-sm text-slate-900">
              {user.email ?? <span className="text-slate-400">Not set</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Status</dt>
            <dd className="mt-1">
              {user.joinedAt === null ? (
                <Badge variant="warning">Invite pending</Badge>
              ) : (
                <Badge variant={user.isActive ? 'success' : 'danger'}>
                  {user.isActive ? 'Active' : 'Inactive'}
                </Badge>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Joined</dt>
            <dd className="mt-1 text-sm text-slate-900">
              {user.joinedAt === null
                ? '—'
                : new Date(user.joinedAt).toLocaleDateString()}
            </dd>
          </div>
        </dl>

        {user.joinedAt === null && canEdit ? (
          <div className="mt-4">
            <Button
              variant="secondary"
              size="sm"
              isLoading={isResending}
              onClick={() => {
                void resendInvite();
              }}
            >
              Resend invite
            </Button>
          </div>
        ) : null}
      </Card>

      <Card header={<CardTitle title="Assignment" />}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Full name"
            value={name}
            disabled={!canEdit || isSaving}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />

          <Select
            label="Role"
            options={ROLE_OPTIONS}
            value={role}
            disabled={!canEdit || isSaving}
            onChange={(event) => {
              setRole(event.target.value);
            }}
          />

          <Select
            label="Branch"
            options={branchOptions}
            value={branchId}
            disabled={!canEdit || isSaving}
            onChange={(event) => {
              setBranchId(event.target.value);
            }}
          />

          <div className="flex items-end">
            <Toggle
              label="Active"
              description="Deactivating signs the user out everywhere."
              checked={isActive}
              disabled={!canEdit || isSaving}
              onChange={setIsActive}
            />
          </div>
        </div>

        {error !== null ? (
          <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        {notice !== null ? (
          <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {notice}
          </p>
        ) : null}

        {canEdit ? (
          <div className="mt-4">
            <Button
              isLoading={isSaving}
              onClick={() => {
                void save();
              }}
            >
              Save changes
            </Button>
          </div>
        ) : (
          <p className="mt-4 text-xs text-slate-500">
            Only a school administrator or HR manager can change these.
          </p>
        )}
      </Card>
    </div>
  );
}
