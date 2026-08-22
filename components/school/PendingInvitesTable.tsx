'use client';

import { MailPlus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@/components/ui/Table';
import { ROLE_LABELS, isUserRole } from '@/types/school-auth';

interface PendingInvite {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  role: string;
  branchName: string | null;
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
        <EmptyState
          bare
          tone="empty"
          icon={MailPlus}
          title="No invitations are pending"
          description="Everyone you have invited has either accepted or been cancelled."
        />
      ) : (
        <Table caption="Pending invitations" className="rounded-none border-0">
          <TableHead>
            <TableRow>
              <TableHeaderCell>Name</TableHeaderCell>
              <TableHeaderCell>Role</TableHeaderCell>
              <TableHeaderCell>Phone</TableHeaderCell>
              <TableHeaderCell>Delivered</TableHeaderCell>
              <TableHeaderCell>Expires</TableHeaderCell>
              <TableHeaderCell>Actions</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
              {invites.map((invite) => (
                <TableRow key={invite.id}>
                  <TableCell rowHeader>{invite.name}</TableCell>
                  <TableCell muted>
                    {isUserRole(invite.role) ? ROLE_LABELS[invite.role] : invite.role}
                  </TableCell>
                  {/* A phone number is compared digit by digit, so it takes the
                      mono face like every other identifier in the product. */}
                  <TableCell muted className="font-mono text-xs">
                    {invite.phone}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
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
                      {!invite.emailSent ? (
                        <Badge variant="danger">Not delivered</Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell muted>{expiresIn(invite.expiresAt)}</TableCell>
                  <TableCell>
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
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
