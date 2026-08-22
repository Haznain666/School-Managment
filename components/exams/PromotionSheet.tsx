'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { SubcategoryBadge } from '@/components/exams/SubcategoryBadge';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { PROMOTION_MECHANISM_LABELS } from '@/db/schema/grade-promotion-criteria';
import {
  OVERRIDE_REASON_MIN,
  PROMOTION_STATUS_LABELS,
  type PromotionStatus,
} from '@/db/schema/student-term-results';
import type { SectionTermResults, SectionTermStudent } from '@/lib/exam-queries';
import { formatPercentage } from '@/lib/grading';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * One class's term, as the class teacher decides it.
 *
 * ── The computed status is shown with its reasons ────────────────────────
 * A teacher asked to override a decision needs to see what they are
 * overriding. A status with no explanation beside it is a status that gets
 * overridden on a hunch, and the reasons come from the same engine that
 * produced the status rather than being written out again here.
 *
 * ── The reason is compulsory, and it is not an audit note ────────────────
 * It prints on the report card and shows on the parent's portal. So the field
 * says so, at the moment it is being typed — a teacher who thinks they are
 * writing a private note writes a different sentence from one who knows the
 * parent will read it.
 *
 * ── Setting the status back clears the reason ────────────────────────────
 * The server does it; this screen just stops showing the field. Half an
 * override left behind is a comment on a parent's portal explaining a decision
 * that was reversed.
 */

export interface PromotionSheetProps {
  results: SectionTermResults;
  canDecide: boolean;
  /**
   * Where a child's earlier years can be read, or null when they cannot.
   *
   * Null when the school has `teachers_can_view_legacy_results` off, which is
   * the default. The link is then **absent** rather than disabled with a
   * tooltip: a control a teacher can see and not use is a control they ask the
   * office about, and last year's marks are not this year's teacher's business
   * unless the school says otherwise.
   */
  historyBasePath?: string | null;
}

interface OverrideDraft {
  finalStatus: PromotionStatus;
  reason: string;
  overallSubcategoryId: string;
}

/**
 * What a draft has to differ from before a reason becomes compulsory.
 *
 * The **stored** computed status, because that is what the override endpoint
 * judges against. `computedStatus` on the row is recomputed on every read so
 * the teacher can see what today's rules say, and the two part company as soon
 * as marks or criteria change after the last recompute. Gating this form on the
 * live value while the server gated on the stored one meant the sheet said "no
 * reason is needed", enabled Save, and the request came back 422 asking for a
 * reason there was no box to type into.
 *
 * Falls back to the live value before the first recompute, when there is no
 * stored row and the endpoint refuses the write anyway.
 */
function basisFor(entry: SectionTermStudent): PromotionStatus {
  return entry.storedComputedStatus ?? entry.computedStatus;
}

export function PromotionSheet({
  results,
  canDecide,
  historyBasePath = null,
}: PromotionSheetProps) {
  const router = useRouter();

  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<OverrideDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const isDescriptorMode = results.mechanism === 'descriptors';
  const endpoint = `/api/school/terms/${results.term.id}/sections/${results.sectionId}/results`;

  const run = async (key: string, work: () => Promise<void>): Promise<void> => {
    setBusy(key);
    setError(null);
    try {
      await work();
      router.refresh();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'That did not work.'));
    } finally {
      setBusy(null);
    }
  };

  const recompute = (): Promise<void> =>
    run('recompute', async () => {
      await schoolFetch(endpoint, { method: 'POST' });
    });

  const apply = (studentProfileId: string): Promise<void> =>
    run(`save:${studentProfileId}`, async () => {
      if (draft === null) return;

      await schoolFetch(endpoint, {
        method: 'PATCH',
        body: JSON.stringify({
          studentProfileId,
          finalStatus: draft.finalStatus,
          overrideReason: draft.reason,
          ...(isDescriptorMode
            ? {
                overallSubcategoryId:
                  draft.overallSubcategoryId === '' ? null : draft.overallSubcategoryId,
              }
            : {}),
        }),
      });

      setOpenId(null);
      setDraft(null);
    });

  return (
    <Card
      header={
        <CardTitle
          title={`${results.gradeName} — ${results.sectionName}`}
          description={`${results.term.name} · ${PROMOTION_MECHANISM_LABELS[results.mechanism]}`}
          action={
            canDecide ? (
              <Button
                size="sm"
                isLoading={busy === 'recompute'}
                onClick={() => {
                  void recompute();
                }}
              >
                Recompute the class
              </Button>
            ) : undefined
          }
        />
      }
    >
      {error !== null ? (
        <p
          role="alert"
          className="mb-4 rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink"
        >
          {error}
        </p>
      ) : null}

      {results.students.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No students are actively enrolled in this class for this year.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {results.students.map((entry) => {
            const studentId = entry.student.studentProfileId;
            const isOpen = openId === studentId;

            return (
              <li key={studentId} className="py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">
                      {entry.student.studentName}
                    </p>
                    <p className="text-xs text-ink-muted">
                      {entry.student.rollNumber === null ||
                      entry.student.rollNumber === ''
                        ? 'No roll number'
                        : `Roll ${entry.student.rollNumber}`}{' '}
                      · <span className="font-mono">{entry.student.studentId}</span>
                    </p>

                    <p className="mt-1 text-sm text-ink-muted">
                      {isDescriptorMode ? (
                        <SubcategoryBadge
                          subcategory={
                            results.subcategories.find(
                              (row) => row.id === entry.overallSubcategoryId,
                            ) ?? null
                          }
                          colorCoded={results.colorCodingEnabled}
                        />
                      ) : (
                        <>
                          {entry.meanPercentage === null
                            ? 'No marks'
                            : formatPercentage(entry.meanPercentage)}
                          {entry.overallGradeLabel === null
                            ? ''
                            : ` · ${entry.overallGradeLabel}`}
                        </>
                      )}
                      {entry.attendancePercentage === null
                        ? ''
                        : ` · attendance ${formatPercentage(entry.attendancePercentage)}`}
                    </p>

                    <ul className="mt-1 space-y-0.5 text-xs text-ink-muted">
                      {entry.reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>

                    {entry.isOverridden && entry.overrideReason !== null ? (
                      <p className="mt-1 text-xs text-ink">
                        <span className="font-medium">Reason given: </span>
                        {entry.overrideReason}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-nowrap items-center gap-2 whitespace-nowrap">
                    <Badge
                      variant={entry.finalStatus === 'promoted' ? 'success' : 'danger'}
                    >
                      {PROMOTION_STATUS_LABELS[entry.finalStatus]}
                    </Badge>
                    {entry.isOverridden ? (
                      <Badge variant="warning">Overridden</Badge>
                    ) : null}
                    {entry.hasRecord ? null : (
                      <Badge variant="neutral">Not computed</Badge>
                    )}

                    {historyBasePath === null ? null : (
                      <Link
                        href={`${historyBasePath}${historyBasePath.includes('?') ? '&' : '?'}student=${studentId}`}
                        className="text-sm font-medium text-brand-primary hover:underline"
                      >
                        History
                      </Link>
                    )}

                    {canDecide && !isOpen ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setOpenId(studentId);
                          setDraft({
                            finalStatus: entry.finalStatus,
                            reason: entry.overrideReason ?? '',
                            overallSubcategoryId: entry.overallSubcategoryId ?? '',
                          });
                          setError(null);
                        }}
                      >
                        Change
                      </Button>
                    ) : null}
                  </div>
                </div>

                {isOpen && draft !== null ? (
                  <div className="mt-3 space-y-3 rounded-lg border border-line bg-surface-sunken p-4">
                    <fieldset>
                      <legend className="mb-2 text-sm font-medium text-ink">
                        Promotion status
                      </legend>
                      <div className="flex flex-wrap gap-4">
                        {(['promoted', 'not_promoted'] as const).map((status) => (
                          <label
                            key={status}
                            className="flex items-center gap-2 text-sm text-ink"
                          >
                            <input
                              type="radio"
                              name={`status-${studentId}`}
                              value={status}
                              checked={draft.finalStatus === status}
                              onChange={() => {
                                setDraft((current) =>
                                  current === null
                                    ? current
                                    : { ...current, finalStatus: status },
                                );
                              }}
                            />
                            {PROMOTION_STATUS_LABELS[status]}
                          </label>
                        ))}
                      </div>
                      <p className="mt-1 text-xs text-ink-muted">
                        The rules say{' '}
                        {PROMOTION_STATUS_LABELS[entry.computedStatus].toLowerCase()}.
                      </p>
                    </fieldset>

                    {isDescriptorMode ? (
                      <label className="block text-sm font-medium text-ink">
                        Overall sub-category
                        <select
                          value={draft.overallSubcategoryId}
                          onChange={(event) => {
                            const value = event.target.value;
                            setDraft((current) =>
                              current === null
                                ? current
                                : { ...current, overallSubcategoryId: value },
                            );
                          }}
                          className="mt-1 block w-full rounded-lg border border-line-strong px-3 py-2 text-sm"
                        >
                          <option value="">Not recorded</option>
                          {results.subcategories.map((row) => (
                            <option key={row.id} value={row.id}>
                              {row.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}

                    {draft.finalStatus === basisFor(entry) ? (
                      <p className="text-xs text-ink-muted">
                        This matches what the rules decided, so no reason is
                        needed — and any reason already recorded is cleared.
                      </p>
                    ) : (
                      <label className="block text-sm font-medium text-ink">
                        Reason for the change
                        <textarea
                          rows={3}
                          value={draft.reason}
                          onChange={(event) => {
                            const value = event.target.value;
                            setDraft((current) =>
                              current === null ? current : { ...current, reason: value },
                            );
                          }}
                          className="mt-1 block w-full rounded-lg border border-line-strong px-3 py-2 text-sm"
                        />
                        <span className="mt-1 block text-xs font-normal text-ink-muted">
                          At least {OVERRIDE_REASON_MIN} characters. This is
                          shown to the parent and printed on the report card.
                        </span>
                      </label>
                    )}

                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        isLoading={busy === `save:${studentId}`}
                        disabled={
                          draft.finalStatus !== basisFor(entry) &&
                          draft.reason.trim().length < OVERRIDE_REASON_MIN
                        }
                        onClick={() => {
                          void apply(studentId);
                        }}
                      >
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setOpenId(null);
                          setDraft(null);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
