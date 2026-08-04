'use client';

import { useCallback, useEffect, useState } from 'react';

import { EmailInviteModal, type BranchOption } from '@/components/school/EmailInviteModal';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';
import { ROLE_LABELS, isUserRole } from '@/types/school-auth';

export interface EmailInvitePanelProps {
  branches: readonly BranchOption[];
}

interface PendingEmailInvite {
  id: string;
  email: string;
  expiresAt: string;
  createdAt: string;
  name: string | null;
  role: string | null;
}

/** "2d left", "5h left", or "expired" — enough to know whether to resend. */
function expiresIn(iso: string): string {
  const hours = Math.round((new Date(iso).getTime() - Date.now()) / (60 * 60 * 1000));
  if (hours <= 0) return 'expired';
  if (hours < 24) return `${hours}h left`;
  return `${Math.round(hours / 24)}d left`;
}

/**
 * The "Invite user" button and the list of invitations still outstanding.
 *
 * The list is the reason this is a panel rather than a lone button: without it
 * an administrator has no way to tell an invitation that is waiting to be
 * accepted from one that was never sent, and the usual response to that
 * uncertainty is to send it again.
 *
 * Inviting the same address again supersedes the pending invitation rather
 * than adding a second, so "resend" is just the same form filled in twice.
 */
export function EmailInvitePanel({ branches }: EmailInvitePanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [invites, setInvites] = useState<PendingEmailInvite[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await schoolFetch<{ invitations: PendingEmailInvite[] }>(
        '/api/school/users/invite',
      );
      setInvites(data.invitations);
      setError(null);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not load pending invitations.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSent = useCallback(
    (email: string) => {
      setIsOpen(false);
      setSuccess(`Invitation sent to ${email}`);
      void load();
    },
    [load],
  );

  return (
    <>
      <Card
        header={
          <CardTitle
            title="Email invitations"
            description="Invite staff by email address. They set their own password."
            action={
              <Button
                onClick={() => {
                  setSuccess(null);
                  setIsOpen(true);
                }}
              >
                Invite User
              </Button>
            }
          />
        }
      >
        {success !== null ? (
          <p
            role="status"
            className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
          >
            {success}
          </p>
        ) : null}

        {error !== null ? (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        {invites === null && error === null ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : null}

        {invites !== null && invites.length === 0 ? (
          <p className="text-sm text-slate-500">No invitations are waiting.</p>
        ) : null}

        {invites !== null && invites.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="pb-2 pr-4 font-medium">Email</th>
                  <th className="pb-2 pr-4 font-medium">Name</th>
                  <th className="pb-2 pr-4 font-medium">Role</th>
                  <th className="pb-2 font-medium">Expires</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invites.map((invite) => (
                  <tr key={invite.id}>
                    <td className="py-2 pr-4 text-slate-900">{invite.email}</td>
                    <td className="py-2 pr-4 text-slate-600">{invite.name ?? '—'}</td>
                    <td className="py-2 pr-4 text-slate-600">
                      {invite.role !== null && isUserRole(invite.role)
                        ? ROLE_LABELS[invite.role]
                        : '—'}
                    </td>
                    <td className="py-2">
                      <Badge>{expiresIn(invite.expiresAt)}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>

      {isOpen ? (
        <EmailInviteModal
          branches={branches}
          onSent={handleSent}
          onClose={() => {
            setIsOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
