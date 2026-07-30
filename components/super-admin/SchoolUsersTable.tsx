'use client';

import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
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
 * School members, with the emergency-link control.
 *
 * The generated link is shown once, in a dialog, and never persisted in the
 * page — it is a live credential for fifteen minutes, so it should not sit in
 * component state longer than the operator needs to copy it.
 */
export function SchoolUsersTable({ schoolId }: SchoolUsersTableProps) {
  const [users, setUsers] = useState<SchoolUserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [issued, setIssued] = useState<EmergencyToken | null>(null);
  const [copied, setCopied] = useState(false);

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
            This school has no users yet. They appear once staff are invited.
          </p>
        </Card>
      ) : (
        <Card className="p-0">
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
