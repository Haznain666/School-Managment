'use client';

import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Textarea } from '@/components/ui/Textarea';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * The moderation queue.
 *
 * ── Safeguarding first, then oldest ──────────────────────────────────────
 * The ordering is the server's and it matters: a queue sorted only by age
 * buries the one report that should never have been in a queue. A
 * `safeguarding` row has *already* emailed the school's designated lead by the
 * time it appears here — this screen is where it is dealt with, not where it is
 * discovered.
 *
 * ── Closing a report needs a sentence ────────────────────────────────────
 * The API refuses a resolution with no note, and this refuses to enable the
 * button without one. "Dismissed" with no reason is the outcome that makes a
 * reporter stop reporting, and a school that stops hearing about bad messages
 * has not stopped having them.
 *
 * ── Removing a message does not delete it ────────────────────────────────
 * Redaction writes three columns and leaves `body` exactly as written. The
 * reader sees that something was removed and by whom rather than seeing a gap,
 * and the export still carries the original — which is the whole reason
 * `chat_messages` is append-only. See its docblock.
 */

interface ReportRow {
  id: string;
  conversationId: string;
  messageId: string;
  source: string;
  severity: string;
  reason: string;
  status: string;
  escalatedAt: string | null;
  createdAt: string;
  messageBody: string;
  messageSender: string;
  messageSenderRole: string;
  messageRedactedAt: string | null;
}

const SEVERITY_VARIANT: Record<string, 'danger' | 'warning' | 'neutral'> = {
  safeguarding: 'danger',
  abuse: 'warning',
  spam: 'neutral',
};

export function ModerationQueue() {
  const [reports, setReports] = useState<ReportRow[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const result = await schoolFetch<{ reports: ReportRow[] }>(
        '/api/school/chat/reports?status=open',
      );
      setReports(result.reports);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'The queue could not be loaded.'));
      setReports([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function resolve(report: ReportRow, status: 'actioned' | 'dismissed'): Promise<void> {
    const note = (notes[report.id] ?? '').trim();
    if (note === '' || busy !== null) return;

    setBusy(report.id);
    setError(null);

    try {
      await schoolFetch('/api/school/chat/reports', {
        method: 'PATCH',
        body: JSON.stringify({ reportId: report.id, status, resolutionNote: note }),
      });
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'That report could not be closed.'));
    } finally {
      setBusy(null);
    }
  }

  async function redact(report: ReportRow): Promise<void> {
    const note = (notes[report.id] ?? '').trim();
    if (note === '' || busy !== null) return;

    setBusy(report.id);
    setError(null);

    try {
      await schoolFetch(`/api/school/chat/messages/${report.messageId}/redact`, {
        method: 'PATCH',
        body: JSON.stringify({ reason: note }),
      });
      await schoolFetch('/api/school/chat/reports', {
        method: 'PATCH',
        body: JSON.stringify({
          reportId: report.id,
          status: 'actioned',
          resolutionNote: note,
        }),
      });
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'That message could not be removed.'));
    } finally {
      setBusy(null);
    }
  }

  if (reports === null) {
    return <p className="text-sm text-ink-muted">Loading reported messages…</p>;
  }

  if (reports.length === 0) {
    return (
      <EmptyState
        title="Nothing reported"
        description="Reported and automatically flagged messages appear here, most serious first."
      />
    );
  }

  return (
    <div className="space-y-4">
      {error !== null ? (
        <p
          role="alert"
          className="rounded-card bg-status-danger-soft px-3 py-2 text-sm text-status-danger-onSoft"
        >
          {error}
        </p>
      ) : null}

      {reports.map((report) => (
        <article key={report.id} className="rounded-card border border-line bg-surface-raised p-4">
          <header className="flex flex-wrap items-center gap-2">
            <Badge variant={SEVERITY_VARIANT[report.severity] ?? 'neutral'}>
              {report.severity === 'safeguarding' ? 'Safeguarding' : report.severity}
            </Badge>
            {report.source === 'scan' ? (
              <Badge variant="neutral">Flagged automatically</Badge>
            ) : null}
            {report.messageRedactedAt !== null ? (
              <Badge variant="neutral">Already removed</Badge>
            ) : null}
            <span className="text-xs text-ink-muted">
              {new Date(report.createdAt).toLocaleString('en-GB')}
            </span>
          </header>

          {report.severity === 'safeguarding' && report.escalatedAt !== null ? (
            <p className="mt-2 text-xs text-ink-muted">
              The safeguarding lead was emailed when this was flagged.
            </p>
          ) : null}

          <p className="mt-3 text-sm text-ink-muted">{report.reason}</p>

          <blockquote className="mt-3 rounded-card bg-surface px-3 py-2 text-sm text-ink">
            <span className="block text-xs font-medium text-ink-muted">
              {report.messageSender} · {report.messageSenderRole.replace(/_/g, ' ')}
            </span>
            <span className="mt-1 block whitespace-pre-wrap break-words">
              {report.messageBody}
            </span>
          </blockquote>

          <div className="mt-3">
            <Textarea
              label="What you decided"
              rows={2}
              maxLength={280}
              value={notes[report.id] ?? ''}
              hint="Required. It is the record of what the school did about this."
              onChange={(event) => {
                const { value } = event.target;
                setNotes((current) => ({ ...current, [report.id]: value }));
              }}
            />
          </div>

          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={busy !== null || (notes[report.id] ?? '').trim() === ''}
              onClick={() => void resolve(report, 'dismissed')}
            >
              Nothing to do
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy !== null || (notes[report.id] ?? '').trim() === ''}
              onClick={() => void resolve(report, 'actioned')}
            >
              Dealt with
            </Button>
            {report.messageRedactedAt === null ? (
              <Button
                variant="danger"
                size="sm"
                disabled={busy !== null || (notes[report.id] ?? '').trim() === ''}
                onClick={() => void redact(report)}
              >
                Remove the message
              </Button>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}
