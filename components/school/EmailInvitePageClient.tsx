'use client';

import Link from 'next/link';
import { useState } from 'react';

import {
  EmailInviteForm,
  type BranchOption,
} from '@/components/school/EmailInviteForm';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

export interface EmailInvitePageClientProps {
  branches: readonly BranchOption[];
}

/**
 * The standalone invite page's client half.
 *
 * A server component cannot hold the "sent" state or reset the form, so this
 * owns both. The form itself is the same component the modal renders.
 *
 * On success the form is replaced by a confirmation rather than cleared in
 * place: an administrator inviting six people needs to see that each one
 * actually went, and an empty form looks identical whether it succeeded or
 * silently did nothing.
 */
export function EmailInvitePageClient({ branches }: EmailInvitePageClientProps) {
  const [sentTo, setSentTo] = useState<string | null>(null);
  // Remounts the form for a second invitation, so every field starts empty.
  const [formKey, setFormKey] = useState(0);

  if (sentTo !== null) {
    return (
      <Card>
        <p role="status" className="text-sm text-slate-900">
          <span className="font-medium">Invitation sent to {sentTo}.</span> They have 72
          hours to open the link and set a password.
        </p>

        <div className="mt-4 flex gap-2">
          <Button
            onClick={() => {
              setSentTo(null);
              setFormKey((current) => current + 1);
            }}
          >
            Invite someone else
          </Button>

          <Link href="/dashboard/users">
            <Button variant="secondary">Back to users</Button>
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-0">
      <EmailInviteForm
        key={formKey}
        branches={branches}
        onSent={(email) => {
          setSentTo(email);
        }}
        secondaryAction={
          <Link href="/dashboard/users">
            <Button variant="secondary">Cancel</Button>
          </Link>
        }
      />
    </Card>
  );
}
