'use client';

import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { superAdminFetch, SuperAdminApiError } from '@/lib/super-admin-client';
import { ROLE_LABELS, isUserRole } from '@/types/school-auth';

interface SchoolUserRow {
  id: string;
  name: string;
  role: string;
  phone: string;
  email: string | null;
  isActive: boolean;
  branchName: string | null;
  joinedAt: string | null;
  hasFirebaseAccount: boolean;
}

interface EmergencyToken {
  url: string;
  expiresAt: string;
  userName: string;
  userRole: string;
}

export interface SchoolUsersTableProps {
  schoolId: string;
}

/**
 * School members, with the emergency-link control and the administrator
 * bootstrap.
 *
 * The generated link is shown once, in a dialog, and never persisted in the
 * page — it is a live credential for fifteen minutes, so it should not sit in
 * component state longer than the operator needs to copy it.
 *
 * The "add administrator" form is the only place the platform operator creates
 * a member. It exists because a school with no members has no way to invite
 * one; everybody after the first arrives through the school's own invitations.
 */
export function SchoolUsersTable({ schoolId }: SchoolUsersTableProps) {
  const [users, setUsers] = useState<SchoolUserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [issued, setIssued] = useState<EmergencyToken | null>(null);
  const [copied, setCopied] = useState(false);

  const [isAdding, setIsAdding] = useState(false);
  const [adminName, setAdminName] = useState('');
  const [adminPhone, setAdminPhone] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [savingAdmin, setSavingAdmin] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await superAdminFetch<{ users: SchoolUserRow[] }>(
        `/api/super-admin/schools/${schoolId}/users`,
      );
      setUsers(data.users);
      setError(null);
    } catch {
      setError('Could not load users.');
    }
  }, [schoolId]);

  useEffect(() => {
    void load();
  }, [load]);

  const generate = useCallback(
    async (userId: string) => {
      setPendingId(userId);
      setError(null);
      setCopied(false);

      try {
        const data = await superAdminFetch<EmergencyToken>(
          `/api/super-admin/schools/${schoolId}/users/${userId}/emergency-token`,
          { method: 'POST' },
        );
        setIssued(data);
      } catch (caught) {
        setError(
          caught instanceof SuperAdminApiError
            ? caught.message
            : 'Could not generate an emergency link.',
        );
      } finally {
        setPendingId(null);
      }
    },
    [schoolId],
  );

  const addAdmin = useCallback(async () => {
    setSavingAdmin(true);
    setError(null);
    setNotice(null);

    try {
      const data = await superAdminFetch<{ userId: string; phone: string }>(
        `/api/super-admin/schools/${schoolId}/users`,
        {
          method: 'POST',
          body: JSON.stringify({
            name: adminName.trim(),
            phone: adminPhone.trim(),
            email: adminEmail.trim(),
          }),
        },
      );

      // The stored number is echoed back because it is normalised on the way
      // in, and it is the exact string they must type on the login screen.
      setNotice(
        `Administrator created. They can now sign in with ${data.phone} — no invite is needed.`,
      );
      setIsAdding(false);
      setAdminName('');
      setAdminPhone('');
      setAdminEmail('');
      await load();
    } catch (caught) {
      setError(
        caught instanceof SuperAdminApiError
          ? caught.message
          : 'Could not create the administrator.',
      );
    } finally {
      setSavingAdmin(false);
    }
  }, [schoolId, adminName, adminPhone, adminEmail, load]);

  const copy = useCallback(async () => {
    if (issued === null) return;
    try {
      await navigator.clipboard.writeText(issued.url);
      setCopied(true);
    } catch {
      // Clipboard access can be refused; the field is selectable either way.
      setCopied(false);
    }
  }, [issued]);

  if (users === null) {
    return (
      <Card>
        <p className="text-sm text-slate-500">{error ?? 'Loading users…'}</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {error !== null ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {notice !== null ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {notice}
        </p>
      ) : null}

      {isAdding ? (
        <Card
          header={
            <CardTitle
              title="Add an administrator"
              description="Creates a school_admin who can sign in immediately with a WhatsApp passcode. Use this only to give a school its first member."
            />
          }
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <Input
              label="Full name"
              value={adminName}
              onChange={(event) => {
                setAdminName(event.target.value);
              }}
            />
            <Input
              label="Mobile number"
              value={adminPhone}
              placeholder="0300-1234567"
              hint="Their login identity. Must be able to receive WhatsApp."
              onChange={(event) => {
                setAdminPhone(event.target.value);
              }}
            />
            <Input
              label="Email (optional)"
              type="email"
              value={adminEmail}
              hint="Fallback channel if WhatsApp fails."
              onChange={(event) => {
                setAdminEmail(event.target.value);
              }}
            />
          </div>

          <div className="mt-4 flex gap-3">
            <Button
              isLoading={savingAdmin}
              disabled={adminName.trim() === '' || adminPhone.trim() === ''}
              onClick={() => {
                void addAdmin();
              }}
            >
              Create administrator
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setIsAdding(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}

      {issued !== null ? (
        <div
          role="dialog"
          aria-labelledby="emergency-link-heading"
          className="rounded-card border border-amber-300 bg-amber-50 p-5"
        >
          <h3 id="emergency-link-heading" className="font-semibold text-amber-900">
            Emergency login link generated
          </h3>
          <p className="mt-1 text-sm text-amber-800">
            This link expires in 15 minutes and can only be used once. It signs
            the recipient in as {issued.userName} — treat it as a password.
          </p>

          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              readOnly
              value={issued.url}
              aria-label="Emergency login URL"
              onFocus={(event) => {
                event.target.select();
              }}
              className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 font-mono text-xs text-slate-800"
            />
            <Button
              size="sm"
              onClick={() => {
                void copy();
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>

          <p className="mt-3 text-xs text-amber-800">
            Send this link directly to {issued.userName} via any channel.
          </p>

          <div className="mt-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setIssued(null);
                setCopied(false);
              }}
            >
              Done
            </Button>
          </div>
        </div>
      ) : null}

      {users.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-600">
            This school has no users yet — and nobody can be invited until it has
            one, because invitations are sent from inside the school portal.
            Create the first administrator here to open it up.
          </p>
          {isAdding ? null : (
            <Button
              className="mt-4"
              onClick={() => {
                setIsAdding(true);
                setNotice(null);
              }}
            >
              Add first administrator
            </Button>
          )}
        </Card>
      ) : (
        <Card
          className="p-0"
          header={
            <CardTitle
              title="Members"
              description={`${users.length} user${users.length === 1 ? '' : 's'} at this school.`}
              action={
                isAdding ? undefined : (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setIsAdding(true);
                      setNotice(null);
                    }}
                  >
                    Add administrator
                  </Button>
                )
              }
            />
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Name</th>
                  <th scope="col" className="px-4 py-3 font-medium">Role</th>
                  <th scope="col" className="px-4 py-3 font-medium">Phone</th>
                  <th scope="col" className="px-4 py-3 font-medium">Email</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                  <th scope="col" className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((user) => (
                  <tr key={user.id}>
                    <td className="px-4 py-3">
                      <span className="font-medium text-slate-900">{user.name}</span>
                      {user.branchName !== null ? (
                        <span className="block text-xs text-slate-500">
                          {user.branchName}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {isUserRole(user.role) ? ROLE_LABELS[user.role] : user.role}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">
                      {user.phone}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {user.email ?? <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {user.joinedAt === null ? (
                        <Badge variant="warning">Invite pending</Badge>
                      ) : (
                        <Badge variant={user.isActive ? 'success' : 'danger'}>
                          {user.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {user.hasFirebaseAccount && user.isActive ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          isLoading={pendingId === user.id}
                          onClick={() => {
                            void generate(user.id);
                          }}
                        >
                          Generate Emergency Login
                        </Button>
                      ) : (
                        <span
                          className="text-xs text-slate-400"
                          title={
                            user.hasFirebaseAccount
                              ? 'Account is deactivated.'
                              : 'This user has not accepted their invite yet.'
                          }
                        >
                          Unavailable
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
