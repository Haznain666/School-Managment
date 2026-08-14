'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { applicationStatusVariant } from '@/components/admissions/ApplicationTable';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import {
  APPLICATION_STATUS_LABELS,
  type ApplicationStatus,
} from '@/db/schema/admission-applications';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * The decision panel on an application.
 *
 * Accept, reject or waitlist, with the option of telling the family over
 * WhatsApp in the same action — a decision the applicant never hears about is
 * not much of a decision. The notification is opt-in per action rather than
 * automatic, because a school reviewing a backlog of fifty should not send
 * fifty messages by accident.
 */

export interface ApplicationReviewCardProps {
  applicationId: string;
  status: ApplicationStatus;
  statusReason: string | null;
  isConverted: boolean;
  /** Sections available for the grade this applicant asked for. */
  sections: ReadonlyArray<{ id: string; label: string }>;
  hasGrade: boolean;
}

const DECISIONS: readonly ApplicationStatus[] = [
  'reviewing',
  'accepted',
  'waitlisted',
  'rejected',
];

export function ApplicationReviewCard({
  applicationId,
  status,
  statusReason,
  isConverted,
  sections,
  hasGrade,
}: ApplicationReviewCardProps) {
  const router = useRouter();

  const [decision, setDecision] = useState<ApplicationStatus>(status);
  const [reason, setReason] = useState(statusReason ?? '');
  const [notify, setNotify] = useState(false);
  const [sectionId, setSectionId] = useState(sections[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<'decision' | 'convert' | null>(null);

  useEffect(() => {
    setDecision(status);
  }, [status]);

  const saveDecision = async (): Promise<void> => {
    if (decision === 'rejected' && reason.trim() === '') {
      setError('Give a reason when rejecting an application.');
      return;
    }

    setBusy('decision');
    setError(null);
    setNotice(null);

    try {
      const result = await schoolFetch<{ notified: boolean }>(
        `/api/school/applications/${applicationId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            status: decision,
            statusReason: reason.trim() === '' ? null : reason.trim(),
            notifyGuardian: notify,
          }),
        },
      );

      setNotice(
        notify && !result.notified
          ? 'Decision saved. The WhatsApp message could not be sent — check the school’s GoHighLevel connection.'
          : 'Decision saved.',
      );
      router.refresh();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not save the decision.'));
    } finally {
      setBusy(null);
    }
  };

  const convert = async (): Promise<void> => {
    if (sectionId === '') {
      setError('Choose the section this student will join.');
      return;
    }

    setBusy('convert');
    setError(null);

    try {
      const created = await schoolFetch<{ studentProfileId: string }>(
        `/api/school/applications/${applicationId}/convert`,
        { method: 'POST', body: JSON.stringify({ sectionId }) },
      );

      router.push(`/dashboard/admissions/students/${created.studentProfileId}`);
      router.refresh();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not convert the application.'));
      setBusy(null);
    }
  };

  if (isConverted) {
    return (
      <Card header={<CardTitle title="Review" />}>
        <p className="text-sm text-ink-muted">
          This application has already been converted into an enrolment, so it can
          no longer be changed.
        </p>
      </Card>
    );
  }

  return (
    <Card
      header={
        <CardTitle
          title="Review"
          description="Record the decision, and optionally tell the guardian."
          action={
            <Badge variant={applicationStatusVariant(status)}>
              {APPLICATION_STATUS_LABELS[status]}
            </Badge>
          }
        />
      }
    >
      <div className="space-y-4">
        <Select
          label="Decision"
          options={DECISIONS.map((value) => ({
            value,
            label: APPLICATION_STATUS_LABELS[value],
          }))}
          value={decision}
          disabled={busy !== null}
          onChange={(event) => {
            setDecision(event.target.value as ApplicationStatus);
          }}
        />

        <Textarea
          label="Reason"
          hint={
            decision === 'rejected'
              ? 'Required. Shared with the guardian if you notify them.'
              : 'Optional note kept with the application.'
          }
          value={reason}
          disabled={busy !== null}
          onChange={(event) => {
            setReason(event.target.value);
          }}
        />

        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={notify}
            disabled={busy !== null}
            onChange={(event) => {
              setNotify(event.target.checked);
            }}
          />
          Send the guardian a WhatsApp about this decision
        </label>

        <Button
          isLoading={busy === 'decision'}
          disabled={busy !== null}
          onClick={() => {
            void saveDecision();
          }}
        >
          Save decision
        </Button>

        {status === 'accepted' ? (
          <div className="rounded-lg border border-line p-4">
            <h3 className="text-sm font-semibold text-ink">
              Convert to enrolment
            </h3>

            {!hasGrade ? (
              <p className="mt-2 text-sm text-status-warning-onSubtle">
                This application does not name a grade, so there is nowhere to
                place the student. Enrol them manually instead.
              </p>
            ) : sections.length === 0 ? (
              <p className="mt-2 text-sm text-status-warning-onSubtle">
                The requested grade has no sections in the active academic year.
                Add one on the Grades &amp; Sections page first.
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                <Select
                  label="Section"
                  options={sections.map((section) => ({
                    value: section.id,
                    label: section.label,
                  }))}
                  value={sectionId}
                  disabled={busy !== null}
                  onChange={(event) => {
                    setSectionId(event.target.value);
                  }}
                />
                <p className="text-sm text-ink-muted">
                  This creates the student record, the placement and the guardian,
                  and syncs both to GoHighLevel — the same as a direct enrolment.
                </p>
                <Button
                  isLoading={busy === 'convert'}
                  disabled={busy !== null}
                  onClick={() => {
                    void convert();
                  }}
                >
                  Convert to enrolment
                </Button>
              </div>
            )}
          </div>
        ) : null}

        {notice !== null ? (
          <p className="rounded-lg bg-status-success-subtle px-3 py-2 text-sm text-status-success-onSubtle">
            {notice}
          </p>
        ) : null}

        {error !== null ? (
          <p role="alert" className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
            {error}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
