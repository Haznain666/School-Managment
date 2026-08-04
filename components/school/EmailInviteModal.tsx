'use client';

import { useEffect, useRef } from 'react';

import {
  EmailInviteForm,
  type BranchOption,
} from '@/components/school/EmailInviteForm';
import { Button } from '@/components/ui/Button';

export type { BranchOption };

export interface EmailInviteModalProps {
  branches: readonly BranchOption[];
  /** Called after a successful send, so the pending list can refresh. */
  onSent: (email: string) => void;
  onClose: () => void;
}

/**
 * The invite form in a dialog, for the users list.
 *
 * Only the framing lives here — the fields, the validation and the POST are
 * `EmailInviteForm`, shared with the standalone /dashboard/users/invite page
 * so the two cannot drift apart.
 */
export function EmailInviteModal({ branches, onSent, onClose }: EmailInviteModalProps) {
  const backdropRef = useRef<HTMLDivElement | null>(null);

  // Escape closes. Anything that covers the page has to be dismissible from
  // the keyboard, not only from the button in the corner.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center"
      onMouseDown={(event) => {
        // Only a click that both starts and ends on the backdrop closes — a
        // drag that ends outside a text selection should not discard the form.
        if (event.target === backdropRef.current) onClose();
      }}
      ref={backdropRef}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-user-title"
        className="w-full max-w-md rounded-card border border-slate-200 bg-white shadow-card"
      >
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 id="invite-user-title" className="text-base font-semibold text-slate-900">
            Invite a user
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            They receive an email with a link and a six-digit code, and choose their own
            password. The invitation is valid for 72 hours.
          </p>
        </div>

        <EmailInviteForm
          branches={branches}
          onSent={onSent}
          secondaryAction={
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          }
        />
      </div>
    </div>
  );
}
