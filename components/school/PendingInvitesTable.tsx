'use client';

import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { ROLE_LABELS, isUserRole } from '@/types/school-auth';

interface PendingInvite {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  role: string;
  branchName: string | null;
  whatsappSent: boolean;
  emailSent: boolean;
  expiresAt: string;
}

interface InvitesResponse {
  ok: boolean;
  data?: { invitations: PendingInvite[] };
  error?: { message: string };
}

function expiresIn(iso: string): string {
  const hours = Math.round((new Date(iso).getTime() - Date.now()) / (60 * 60 * 1000));
  if (hours <= 0) return 'expired';
  if (hours < 24) return `${hours}h left`;
  return `${Math.round(hours / 24)}d left`;
}

/** Invitations that have been sent but not yet accepted. */
export function PendingInvitesTable() {
  const [invites, setInvites] = useState<PendingInvite[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/school/invitations');
      const payload = (await response.json()) as InvitesResponse;

      if (!response.ok || payload.ok !== true || payload.data === undefined) {
        setError(payload.error?.message ?? 'Could not load invitations.');
        return;
      }

      setInvites(payload.data.invitations);
      setError(null);
    } catch {
      setError('Could not load invitations.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = useCallback(
    async (id: string, action: 'resend' | 'cancel') => {
      setPendingId(id);
      setError(null);

      try {
        const response = await fetch(`/api/school/invitations/${id}/${action}`, {
          method: action === 'resend' ? 'POST' : 'DELETE',
        });

        if (!response.ok) {
          const payload = (await response.json()) as InvitesResponse;
          setError(payload.error?.message ?? `Could not ${action} the invitation.`);
          return;
        }

        await load();
      } catch {
        setError(`Could not ${action} the invitation.`);
      } finally {
        setPendingId(null);
      }
    },
    [load],
  );

  if (invites === null) {
    return (
      <Card header={<CardTitle title="Pending invitations" />}>
        <p className="text-sm text-ink-muted">{error ?? 'Loading invitations…'}</p>
      </Card>
    );
  }

  return (
    <Card
      header={
        <CardTitle
          title="Pending invitations"
          description="Sent but not yet accepted. Links are valid for 72 hours."
        />
      }
      className="p-0"
    >
      {error !== null ? (
        <p role="alert" className="mx-4 mt-4 rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}

      {invites.length === 0 ? (
        <p className="px-5 py-4 text-sm text-ink-muted">No invitations are pending.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Name</th>
                <th scope="col" className="px-4 py-3 font-medium">Role</th>
                <th scope="col" className="px-4 py-3 font-medium">Phone</th>
                <th scope="col" className="px-4 py-3 font-medium">Delivered</th>
                <th scope="col" className="px-4 py-3 font-medium">Expires</th>
                <th scope="col" className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {invites.map((invite) => (
                <tr key={invite.id}>
                  <td className="px-4 py-3 font-medium text-ink">{invite.name}</td>
                  <td className="px-4 py-3 text-ink-muted">
                    {isUserRole(invite.role) ? ROLE_LABELS[invite.role] : invite.role}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-ink-muted">
                    {invite.phone}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      {invite.whatsappSent ? (
                        <Badge variant="success">WhatsApp</Badge>
                      ) : null}
                      {/*
                        "queued", not "sent": the message is handed to the
                        outbox and delivered outside the request, so at the
                        moment this row was written nothing had reached an SMTP
                        server yet. A badge reading "Email" next to a message
                        that later bounced is the lie this wording avoids.
                      */}
                      {invite.emailSent ? (
                        <Badge variant="neutral">Email queued</Badge>
                      ) : null}
                      {!invite.whatsappSent && !invite.emailSent ? (
                        <Badge variant="danger">Not delivered</Badge>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{expiresIn(invite.expiresAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        isLoading={pendingId === invite.id}
                        onClick={() => {
                          void act(invite.id, 'resend');
                        }}
                      >
                        Resend
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pendingId !== null}
                        onClick={() => {
                          void act(invite.id, 'cancel');
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
