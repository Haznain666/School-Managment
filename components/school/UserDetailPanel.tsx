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
  /** Non-null once the person has a Supabase identity — i.e. has signed in. */
  authUserId: string | null;
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

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  // Kept apart from `error` above so a refusal is reported next to the button
  // that caused it, rather than in the Assignment card further up the page.
  const [deleteError, setDeleteError] = useState<string | null>(null);

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

  /**
   * Sends this member their way in again.
   *
   * ── What this used to do, and why it could not stay ──────────────────
   * It POSTed to `/api/school/invitations` with the member's own details, on
   * the reasoning that "re-inviting reuses the invitation flow rather than
   * creating a second account for the same phone number". Since Sprint 17 that
   * route *creates the member*, and the phone is unique per school — so the
   * button on an existing profile would have answered 409 "someone with that
   * phone number already exists", naming the very person whose page it is on.
   *
   * The replacement is the school-side twin of the Super Admin's send-signin:
   * it mails a setup link to somebody who has never signed in, and the portal
   * address to somebody who has. Which of the two is decided on the server off
   * `auth_user_id`; this screen only reports which one went.
   */
  const sendAccessEmail = useCallback(async () => {
    setIsResending(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/school/users/${user.id}/send-access`, {
        method: 'POST',
      });

      const payload = (await response.json()) as {
        ok: boolean;
        data?: { email: string; firstTime: boolean };
        error?: { message: string };
      };

      if (!response.ok || payload.ok !== true) {
        setError(payload.error?.message ?? 'Could not send the access email.');
        return;
      }

      // Queued, not sent — the email leaves the outbox seconds from now. See
      // `lib/email-outbox.ts`.
      setNotice(
        payload.data?.firstTime === false
          ? `Sign-in instructions queued to ${payload.data.email}. They already have a password, so no setup link was included.`
          : `A password-setup link has been queued to ${payload.data?.email ?? 'their address'}. It usually arrives within a minute.`,
      );
    } catch {
      setError('Could not send the access email.');
    } finally {
      setIsResending(false);
    }
  }, [user.id]);

  const remove = useCallback(async () => {
    setIsDeleting(true);
    setDeleteError(null);

    try {
      const response = await fetch(`/api/school/users/${user.id}`, { method: 'DELETE' });
      const payload = (await response.json()) as {
        ok: boolean;
        error?: { message: string };
      };

      if (!response.ok || payload.ok !== true) {
        setDeleteError(payload.error?.message ?? 'Could not delete this user.');
        setConfirmingDelete(false);
        return;
      }

      // The profile this page shows no longer exists, so there is nothing to
      // refresh into — go back to the directory rather than render a 404.
      router.push('/dashboard/users');
      router.refresh();
    } catch {
      setDeleteError('Could not delete this user.');
      setConfirmingDelete(false);
    } finally {
      setIsDeleting(false);
    }
  }, [user.id, router]);

  const branchOptions = [
    { value: '', label: branchRequired ? 'Select a branch' : 'All branches' },
    ...branches.map((branch) => ({ value: branch.id, label: branch.name })),
  ];

  return (
    <div className="space-y-6">
      <Card header={<CardTitle title="Profile" />}>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-ink-muted">Phone</dt>
            <dd className="mt-1 font-mono text-sm text-ink">{user.phone}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-ink-muted">Email</dt>
            <dd className="mt-1 text-sm text-ink">
              {user.email ?? <span className="text-ink-muted">Not set</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-ink-muted">Status</dt>
            <dd className="mt-1">
              {/*
                From `authUserId`, not `joinedAt`. "Invite pending" implied an
                invitation was on its way; for anyone added with "Add
                administrator" there never was one (STATE.md §5g), and the
                directory table was corrected but this panel was missed.
              */}
              {!user.isActive ? (
                <Badge variant="danger">Deactivated</Badge>
              ) : user.authUserId === null ? (
                <Badge variant="warning">Never signed in</Badge>
              ) : (
                <Badge variant="success">Active</Badge>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-ink-muted">Joined</dt>
            <dd className="mt-1 text-sm text-ink">
              {user.joinedAt === null
                ? '—'
                : new Date(user.joinedAt).toLocaleDateString()}
            </dd>
          </div>
        </dl>

        {/*
          Offered to everyone, not only to somebody who has never joined.

          It was gated on `joinedAt === null`, which made the one thing an
          administrator reaches for — "she has lost the link, send it again" —
          unavailable the moment the person had signed in once. The two emails
          are different and the server picks between them, so an established
          member simply gets the portal address rather than a password link.
        */}
        {canEdit ? (
          <div className="mt-4">
            <Button
              variant="secondary"
              size="sm"
              isLoading={isResending}
              onClick={() => {
                void sendAccessEmail();
              }}
            >
              Send access email
            </Button>
            <p className="mt-2 text-xs text-ink-muted">
              {user.authUserId === null
                ? 'Sends a single-use link for choosing a password.'
                : 'They already have a password, so this sends the portal address only.'}
            </p>
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
          <p role="alert" className="mt-4 rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
            {error}
          </p>
        ) : null}

        {notice !== null ? (
          <p className="mt-4 rounded-lg bg-status-success-subtle px-3 py-2 text-sm text-status-success-ink">
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
          <p className="mt-4 text-xs text-ink-muted">
            Only a school administrator or HR manager can change these.
          </p>
        )}
      </Card>

      {canEdit ? (
        <Card
          header={
            <CardTitle
              title="Delete this user"
              description="Removes them from the directory entirely. Deactivating is reversible; this is not."
            />
          }
        >
          <p className="text-sm text-ink-muted">
            Delete is for a row that should never have existed — a mistyped
            address, a duplicate, an invitation to the wrong person. Anyone
            whose name is already on a record the school keeps cannot be
            deleted, and saying so is the point: attendance they marked and
            payroll they ran stay attributable. Deactivate those people instead.
          </p>

          {deleteError !== null ? (
            <p
              role="alert"
              className="mt-4 rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink"
            >
              {deleteError}
            </p>
          ) : null}

          {confirmingDelete ? (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <span className="text-sm text-status-danger-ink">
                Delete {user.name} permanently?
              </span>
              <Button
                variant="danger"
                size="sm"
                isLoading={isDeleting}
                onClick={() => {
                  void remove();
                }}
              >
                Delete
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={isDeleting}
                onClick={() => {
                  setConfirmingDelete(false);
                }}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <div className="mt-4">
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  setConfirmingDelete(true);
                  setError(null);
                  setNotice(null);
                }}
              >
                Delete user
              </Button>
            </div>
          )}
        </Card>
      ) : null}
    </div>
  );
}
