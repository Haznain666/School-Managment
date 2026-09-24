'use client';

import { useCallback, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { superAdminFetch, SuperAdminApiError } from '@/lib/super-admin-client';
import {
  emptySuperAdminPermissions,
  SUPER_ADMIN_ACTION_LABELS,
  SUPER_ADMIN_ACTIONS,
  SUPER_ADMIN_AREA_DESCRIPTIONS,
  SUPER_ADMIN_AREA_LABELS,
  SUPER_ADMIN_AREAS,
  type SuperAdminAction,
  type SuperAdminArea,
  type SuperAdminPermissions,
} from '@/lib/super-admin-permissions';

/**
 * The operators — Sprint 35, §9.
 *
 * Three levels of reach on one screen, and each control is drawn only for the
 * people it works for, so nobody is shown a button the server will refuse:
 *
 *   · anybody with `super_admins` view sees the list;
 *   · create / edit / delete appear to whoever holds that action — never on
 *     the owner's row, which nobody but the owner touches, and never for
 *     removing yourself;
 *   · the permission grid is drawn for **the owner only**. Everybody else sees
 *     what an admin holds, read-only, because "may edit admins" is not "may
 *     decide what admins can do" (Q4).
 */

export interface SuperAdminRow {
  id: string;
  email: string;
  name: string;
  isOwner: boolean;
  isActive: boolean;
  permissions: SuperAdminPermissions;
  lastSignInAt: string | null;
  createdAt: string;
  createdBy: string | null;
}

export interface SuperAdminsManagerProps {
  initial: SuperAdminRow[];
  viewer: { adminId: string | null; isOwner: boolean };
  can: { create: boolean; edit: boolean; delete: boolean };
}

interface EditState {
  id: string | 'new';
  name: string;
  email: string;
  password: string;
  isActive: boolean;
  permissions: SuperAdminPermissions;
  isOwner: boolean;
}

function summarise(permissions: SuperAdminPermissions): string {
  const held = SUPER_ADMIN_AREAS.filter((area) => permissions[area].r).map(
    (area) => SUPER_ADMIN_AREA_LABELS[area],
  );
  return held.length === 0 ? 'Nothing yet' : held.join(', ');
}

export function SuperAdminsManager({ initial, viewer, can }: SuperAdminsManagerProps) {
  const [admins, setAdmins] = useState(initial);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [deleting, setDeleting] = useState<SuperAdminRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const toggle = (area: SuperAdminArea, action: SuperAdminAction) => {
    setEditing((current) => {
      if (current === null) return current;
      const next = structuredClone(current.permissions);
      next[area][action] = !next[area][action];
      // View is implied by any other action, and taking it away takes the rest.
      if (action !== 'r' && next[area][action]) next[area].r = true;
      if (action === 'r' && !next[area].r) {
        next[area].c = false;
        next[area].u = false;
        next[area].d = false;
      }
      return { ...current, permissions: next };
    });
  };

  const save = useCallback(async () => {
    if (editing === null) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const original = admins.find((admin) => admin.id === editing.id);
      const body: Record<string, unknown> = {};

      if (editing.id === 'new') {
        body.name = editing.name;
        body.email = editing.email;
        body.password = editing.password;
        if (viewer.isOwner) body.permissions = editing.permissions;
      } else {
        if (original === undefined || editing.name !== original.name) body.name = editing.name;
        if (!editing.isOwner) {
          if (original === undefined || editing.email !== original.email) body.email = editing.email;
          if (original === undefined || editing.isActive !== original.isActive) body.isActive = editing.isActive;
          if (editing.password !== '') body.password = editing.password;
          if (viewer.isOwner) body.permissions = editing.permissions;
        }
      }

      const data =
        editing.id === 'new'
          ? await superAdminFetch<{ admins: SuperAdminRow[] }>('/api/super-admin/admins', {
              method: 'POST',
              body: JSON.stringify(body),
            })
          : await superAdminFetch<{ admins: SuperAdminRow[] }>(`/api/super-admin/admins/${editing.id}`, {
              method: 'PATCH',
              body: JSON.stringify(body),
            });

      setAdmins(data.admins);
      setNotice(editing.id === 'new' ? `${editing.name} can now sign in.` : 'Saved.');
      setEditing(null);
    } catch (caught) {
      setError(caught instanceof SuperAdminApiError ? caught.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }, [editing, admins, viewer.isOwner]);

  const remove = useCallback(async (admin: SuperAdminRow) => {
    setBusy(true);
    setError(null);
    try {
      const data = await superAdminFetch<{ admins: SuperAdminRow[] }>(`/api/super-admin/admins/${admin.id}`, {
        method: 'DELETE',
      });
      setAdmins(data.admins);
      setDeleting(null);
      setNotice(`${admin.name} was removed.`);
    } catch (caught) {
      setError(caught instanceof SuperAdminApiError ? caught.message : 'Could not remove.');
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="space-y-6">
      {error !== null ? (
        <p role="alert" className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}
      {notice !== null ? (
        <p role="status" className="rounded-lg bg-status-success-subtle px-3 py-2 text-sm text-status-success-ink">
          {notice}
        </p>
      ) : null}

      {can.create ? (
        <Button
          onClick={() => {
            setError(null);
            setEditing({
              id: 'new',
              name: '',
              email: '',
              password: '',
              isActive: true,
              permissions: emptySuperAdminPermissions(),
              isOwner: false,
            });
          }}
        >
          Add super admin
        </Button>
      ) : null}

      <Card>
        <ul className="divide-y divide-line">
          {admins.map((admin) => {
            const isSelf = admin.id === viewer.adminId;
            const mayEdit = admin.isOwner ? viewer.isOwner : can.edit;
            return (
              <li key={admin.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                    {admin.name}
                    {admin.isOwner ? <Badge variant="brand">Owner</Badge> : null}
                    {!admin.isActive ? <Badge variant="danger">Inactive</Badge> : null}
                    {isSelf ? <Badge variant="neutral">You</Badge> : null}
                  </p>
                  <p className="text-sm text-ink-muted">{admin.email}</p>
                  <p className="mt-1 text-xs text-ink-muted">
                    {admin.isOwner ? 'Everything, always.' : summarise(admin.permissions)}
                    {admin.lastSignInAt === null
                      ? ' · never signed in'
                      : ` · last signed in ${new Date(admin.lastSignInAt).toLocaleString('en-GB')}`}
                  </p>
                </div>
                <div className="flex gap-2">
                  {mayEdit ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setError(null);
                        setEditing({
                          id: admin.id,
                          name: admin.name,
                          email: admin.email,
                          password: '',
                          isActive: admin.isActive,
                          permissions: structuredClone(admin.permissions),
                          isOwner: admin.isOwner,
                        });
                      }}
                    >
                      Edit
                    </Button>
                  ) : null}
                  {can.delete && !admin.isOwner && !isSelf ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setDeleting(admin);
                      }}
                    >
                      Delete
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      {editing !== null ? (
        <Card
          header={
            <CardTitle
              title={editing.id === 'new' ? 'New super admin' : `Edit ${editing.name}`}
              description={
                editing.isOwner
                  ? 'The owner’s email and status cannot change, and the owner holds every permission.'
                  : undefined
              }
            />
          }
        >
          <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <Input
                label="Name"
                value={editing.name}
                disabled={busy}
                onChange={(event) => {
                  setEditing({ ...editing, name: event.target.value });
                }}
              />
              <Input
                label="Email"
                type="email"
                value={editing.email}
                disabled={busy || editing.isOwner}
                onChange={(event) => {
                  setEditing({ ...editing, email: event.target.value });
                }}
              />
              {!editing.isOwner ? (
                <Input
                  label={editing.id === 'new' ? 'Password' : 'Reset password (leave blank to keep)'}
                  type="password"
                  autoComplete="new-password"
                  value={editing.password}
                  disabled={busy}
                  hint="At least 12 characters, with letters and a number."
                  onChange={(event) => {
                    setEditing({ ...editing, password: event.target.value });
                  }}
                />
              ) : null}
              {!editing.isOwner && editing.id !== 'new' && editing.id !== viewer.adminId ? (
                <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={editing.isActive}
                    disabled={busy}
                    onChange={(event) => {
                      setEditing({ ...editing, isActive: event.target.checked });
                    }}
                  />
                  Active — can sign in
                </label>
              ) : null}
            </div>

            {!editing.isOwner ? (
              <div className="space-y-2">
                <p className="text-sm font-medium text-ink">Permissions</p>
                {!viewer.isOwner ? (
                  <p className="text-xs text-ink-muted">Only the platform owner can change these.</p>
                ) : null}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-2xs uppercase tracking-wide text-ink-muted">
                        <th className="py-2 font-semibold">Area</th>
                        {SUPER_ADMIN_ACTIONS.map((action) => (
                          <th key={action} className="px-2 py-2 text-center font-semibold">
                            {SUPER_ADMIN_ACTION_LABELS[action]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {SUPER_ADMIN_AREAS.map((area) => (
                        <tr key={area}>
                          <td className="py-2">
                            <span className="text-ink">{SUPER_ADMIN_AREA_LABELS[area]}</span>
                            <span className="block text-xs text-ink-muted">
                              {SUPER_ADMIN_AREA_DESCRIPTIONS[area]}
                            </span>
                          </td>
                          {SUPER_ADMIN_ACTIONS.map((action) => (
                            <td key={action} className="px-2 py-2 text-center">
                              <input
                                type="checkbox"
                                aria-label={`${SUPER_ADMIN_AREA_LABELS[area]}: ${SUPER_ADMIN_ACTION_LABELS[action]}`}
                                checked={editing.permissions[area][action]}
                                disabled={busy || !viewer.isOwner}
                                onChange={() => {
                                  toggle(area, action);
                                }}
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            <div className="flex gap-2">
              <Button isLoading={busy} onClick={() => void save()}>
                {editing.id === 'new' ? 'Create super admin' : 'Save'}
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setEditing(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      <Modal
        open={deleting !== null}
        onClose={() => {
          setDeleting(null);
        }}
        title={`Delete ${deleting?.name ?? 'this admin'}?`}
        description="They are signed out on their next click and cannot sign in again."
        size="sm"
        footer={
          <>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setDeleting(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              isLoading={busy}
              onClick={() => {
                if (deleting !== null) void remove(deleting);
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-muted">
          To keep the account but stop it signing in, edit it and untick Active instead.
        </p>
      </Modal>
    </div>
  );
}
