'use client';

import { useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * The pupil's own sign-in, on their record.
 *
 * ── Why this card exists at all ──────────────────────────────────────────
 * `POST /api/school/students/[id]/credentials` was written in Sprint 24 and
 * **nothing in the product ever called it**. There was no button, on this
 * screen or any other, so no school ever issued a pupil a login and the
 * product owner reported the feature as unusable — correctly. Half of Sprint
 * 26's item 3 is this card; the other half is that pressing it now mails the
 * guardians instead of printing a password on the screen.
 *
 * ── The login id is shown, the password never is ─────────────────────────
 * The address is deterministic — admission number plus school slug — so it is
 * drawn whether or not anything has been issued yet, and a clerk can recognise
 * it in a parent's screenshot. The password is not in this component's props,
 * not in the API response and not in any log: the only copy that leaves the
 * server is the one in the guardians' inbox.
 *
 * ── A disabled button that says why ──────────────────────────────────────
 * Below the school's class threshold there is no button at all, and the card
 * says which class access starts at. A control that appears and then refuses
 * teaches people the product is unreliable; a sentence explaining a rule
 * teaches them the rule.
 */

export interface PortalAccessSnapshot {
  eligible: boolean;
  reason: string | null;
  gradeName: string | null;
  thresholdGradeName: string | null;
  loginId: string;
  /** ISO, or null when never issued. Serialised by the page. */
  issuedAt: string | null;
  recipients: string[];
}

interface Delivery {
  guardianName: string;
  email: string | null;
  queued: boolean;
  reason: string | null;
}

export function StudentPortalAccessCard({
  studentProfileId,
  studentName,
  access,
  canEdit,
}: {
  studentProfileId: string;
  studentName: string;
  access: PortalAccessSnapshot;
  canEdit: boolean;
}) {
  const [state, setState] = useState(access);
  const [deliveries, setDeliveries] = useState<Delivery[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function issue(): Promise<void> {
    setBusy(true);
    setError(null);
    setDeliveries(null);

    try {
      const result = await schoolFetch<{
        loginId: string;
        reissued: boolean;
        deliveries: Delivery[];
      }>(`/api/school/students/${studentProfileId}/credentials`, { method: 'POST' });

      setDeliveries(result.deliveries);
      setState((was) => ({
        ...was,
        loginId: result.loginId,
        issuedAt: new Date().toISOString(),
      }));
    } catch (caught) {
      // Verbatim. Every refusal from this path is a sentence written to be read
      // by whoever hit it — "Portal access starts at Year 6", not "Forbidden".
      setError(schoolErrorMessage(caught, 'The sign-in could not be issued.'));
    } finally {
      setBusy(false);
    }
  }

  const issued = state.issuedAt !== null;

  return (
    <Card header={<CardTitle title="Student portal access" />}>
      <p className="text-sm text-ink-muted">
        {studentName} signs in with the ID below. The password is emailed to
        their guardians, never shown here and never sent to the student.
      </p>

      <dl className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
            Login ID
          </dt>
          <dd className="mt-1 break-all font-mono text-sm text-ink">{state.loginId}</dd>
          <p className="mt-1 text-xs text-ink-muted">
            An identifier, not a mailbox. It can neither send nor receive email.
          </p>
        </div>

        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
            Status
          </dt>
          <dd className="mt-1 text-sm text-ink">
            {issued ? (
              <>
                <Badge variant="success">Access sent</Badge>{' '}
                <span className="text-ink-muted">
                  {new Date(state.issuedAt ?? '').toLocaleString('en-GB', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </>
            ) : state.eligible ? (
              <Badge variant="warning">Not sent yet</Badge>
            ) : (
              <Badge variant="neutral">Not eligible</Badge>
            )}
          </dd>
        </div>
      </dl>

      {!state.eligible && state.reason !== null ? (
        <p className="mt-4 rounded-card bg-surface px-3 py-2 text-sm text-ink-muted">
          {state.reason}
        </p>
      ) : null}

      {state.eligible && state.recipients.length === 0 ? (
        <p className="mt-4 rounded-card bg-status-warning-subtle px-3 py-2 text-sm text-status-warning-onSubtle">
          No guardian on this record has an email address, so there is nobody to
          send the sign-in to. Add one below first.
        </p>
      ) : null}

      {state.eligible && state.recipients.length > 0 ? (
        <p className="mt-4 text-sm text-ink-muted">
          Will be sent to {state.recipients.join(' and ')}.
        </p>
      ) : null}

      {error !== null ? (
        <p
          role="alert"
          className="mt-4 rounded-card bg-status-danger-soft px-3 py-2 text-sm text-status-danger-onSoft"
        >
          {error}
        </p>
      ) : null}

      {deliveries !== null ? (
        <ul className="mt-4 space-y-1 text-sm">
          {deliveries.map((delivery) => (
            <li
              key={`${delivery.guardianName}-${delivery.email ?? 'none'}`}
              className={delivery.queued ? 'text-ink' : 'text-ink-muted'}
            >
              {delivery.queued
                ? `Sent to ${delivery.guardianName} at ${delivery.email ?? ''}.`
                : `${delivery.guardianName}: ${delivery.reason ?? 'not sent.'}`}
            </li>
          ))}
        </ul>
      ) : null}

      {canEdit && state.eligible ? (
        <div className="mt-4">
          <Button onClick={() => void issue()} disabled={busy}>
            {busy
              ? 'Sending…'
              : issued
                ? 'Generate a new password and email it'
                : 'Send portal access'}
          </Button>
          {issued ? (
            <p className="mt-2 text-xs text-ink-muted">
              The previous password stops working the moment a new one is
              issued.
            </p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
