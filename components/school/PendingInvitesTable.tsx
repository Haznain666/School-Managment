'use client';

import { MailPlus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
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

  const columns: Array<DataTableColumn<PendingInvite>> = [
    {
      id: 'name',
      header: 'Name',
      rowHeader: true,
      sortValue: (invite) => invite.name,
      searchValue: (invite) => `${invite.name} ${invite.email ?? ''} ${invite.phone}`,
      cell: (invite) => invite.name,
    },
    {
      id: 'role',
      header: 'Role',
      muted: true,
      sortValue: (invite) =>
        isUserRole(invite.role) ? ROLE_LABELS[invite.role] : invite.role,
      cell: (invite) => (isUserRole(invite.role) ? ROLE_LABELS[invite.role] : invite.role),
    },
    {
      // A phone number is compared digit by digit, so it takes the mono face
      // like every other identifier in the product.
      id: 'phone',
      header: 'Phone',
      muted: true,
      className: 'font-mono text-xs',
      sortValue: (invite) => invite.phone,
      cell: (invite) => invite.phone,
    },
    {
      id: 'delivered',
      header: 'Delivered',
      sortValue: (invite) => (invite.emailSent ? 0 : 1),
      cell: (invite) => (
        <div className="flex gap-1">
          {/*
            "queued", not "sent": the message is handed to the outbox and
            delivered outside the request, so at the moment this row was written
            nothing had reached an SMTP server yet. A badge reading "Email" next
            to a message that later bounced is the lie this wording avoids.
          */}
          {invite.emailSent ? (
            <Badge variant="neutral">Email queued</Badge>
          ) : (
            <Badge variant="danger">Not delivered</Badge>
          )}
        </div>
      ),
    },
    {
      id: 'expires',
      header: 'Expires',
      kind: 'date',
      muted: true,
      sortValue: (invite) => invite.expiresAt,
      cell: (invite) => expiresIn(invite.expiresAt),
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (invite) => (
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
      ),
    },
  ];

  return (
    <Card
      header={
        <CardTitle
          title="Pending invitations"
          description="Sent but not yet accepted. Links are valid for 72 hours."
        />
      }
    >
      {error !== null ? (
        <p role="alert" className="mx-4 mt-4 rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}

      <div>
        <DataTable
          caption="Pending invitations"
          columns={columns}
          rows={invites ?? []}
          getRowKey={(invite) => invite.id}
          pending={invites === null}
          defaultSort={{ columnId: 'expires', direction: 'asc' }}
          search={{ placeholder: 'Name, phone or email' }}
          filters={[
            {
              id: 'delivered',
              label: 'Delivery',
              allLabel: 'Every invitation',
              options: [
                { value: 'queued', label: 'Email queued' },
                { value: 'failed', label: 'Not delivered' },
              ],
              rowValue: (invite) => (invite.emailSent ? 'queued' : 'failed'),
            },
          ]}
          itemNoun={{ singular: 'invitation', plural: 'invitations' }}
          emptyIcon={MailPlus}
          emptyTitle="No invitations are pending"
          emptyDescription="Everyone you have invited has either accepted or been cancelled."
          noResultTitle="No invitations match those filters"
          noResultDescription="Clear the search, or show every invitation."
        />
      </div>
    </Card>
  );
}
