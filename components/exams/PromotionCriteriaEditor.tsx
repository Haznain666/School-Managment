'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import {
  PROMOTION_MECHANISM_LABELS,
  PROMOTION_MECHANISMS,
  type PromotionMechanism,
} from '@/db/schema/grade-promotion-criteria';
import type { GradeCriteriaRow, ResultSubcategoryRow } from '@/lib/exam-queries';
import { criteriaProblem, type CriteriaRow } from '@/lib/promotion-criteria';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * How each class is judged this year: which mechanism, and the thresholds.
 *
 * ── The mechanism decides what the row means ─────────────────────────────
 * A marks class is judged on a percentage and a count of failed subjects; a
 * descriptor class on how many subjects landed in the descriptor the school
 * calls a fail. They are alternatives, so only the fields belonging to the
 * chosen mechanism are shown — leaving both sets on screen would invite a
 * school to fill in a threshold that is never read and then wonder why nobody
 * was ever held back by it.
 *
 * ── A blank threshold is not zero ────────────────────────────────────────
 * It is *not applied*. A class with every field blank promotes everybody, which
 * is exactly how this product behaved before the criteria table existed. The
 * hint under each field says so, because a school pressing recompute and
 * finding a class of forty held back by a default nobody chose is the failure
 * this screen exists to avoid.
 */

export interface PromotionCriteriaEditorProps {
  academicYearId: string;
  academicYears: readonly { id: string; name: string }[];
  criteria: readonly GradeCriteriaRow[];
  subcategories: readonly ResultSubcategoryRow[];
  gradingSchemes: readonly { id: string; name: string }[];
  canWrite: boolean;
}

interface Draft {
  mechanism: PromotionMechanism;
  gradingSchemeId: string;
  minOverallPercentage: string;
  maxFailedSubjects: string;
  failingSubcategoryId: string;
  maxFailingSubjects: string;
  minAttendancePercentage: string;
}

function toDraft(row: GradeCriteriaRow): Draft {
  return {
    mechanism: row.mechanism,
    gradingSchemeId: row.gradingSchemeId ?? '',
    minOverallPercentage:
      row.minOverallPercentage === null ? '' : String(row.minOverallPercentage),
    maxFailedSubjects: row.maxFailedSubjects === null ? '' : String(row.maxFailedSubjects),
    failingSubcategoryId: row.failingSubcategoryId ?? '',
    maxFailingSubjects:
      row.maxFailingSubjects === null ? '' : String(row.maxFailingSubjects),
    minAttendancePercentage:
      row.minAttendancePercentage === null ? '' : String(row.minAttendancePercentage),
  };
}

function toCriteria(draft: Draft): CriteriaRow {
  const number = (value: string): number | null =>
    value.trim() === '' ? null : Number(value);

  return {
    mechanism: draft.mechanism,
    gradingSchemeId: draft.gradingSchemeId === '' ? null : draft.gradingSchemeId,
    minOverallPercentage: number(draft.minOverallPercentage),
    maxFailedSubjects: number(draft.maxFailedSubjects),
    failingSubcategoryId:
      draft.failingSubcategoryId === '' ? null : draft.failingSubcategoryId,
    maxFailingSubjects: number(draft.maxFailingSubjects),
    minAttendancePercentage: number(draft.minAttendancePercentage),
  };
}

export function PromotionCriteriaEditor({
  academicYearId,
  academicYears,
  criteria,
  subcategories,
  gradingSchemes,
  canWrite,
}: PromotionCriteriaEditorProps) {
  const router = useRouter();

  const [editingGradeId, setEditingGradeId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const problem = draft === null ? null : criteriaProblem(toCriteria(draft));

  const save = async (gradeId: string): Promise<void> => {
    if (draft === null) return;

    setBusy(gradeId);
    setError(null);

    try {
      await schoolFetch('/api/school/promotion-criteria', {
        method: 'PUT',
        body: JSON.stringify({
          academicYearId,
          gradeId,
          ...toCriteria(draft),
        }),
      });
      setEditingGradeId(null);
      setDraft(null);
      router.refresh();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'The criteria could not be saved.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card
      header={
        <CardTitle
          title="Promotion criteria"
          description="One row per class. A class with no criteria set promotes everybody."
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

      {/* Criteria are per year, so a school can set next session's before it
          starts. The switch navigates rather than refetching: the page is
          already a server read and one round trip is fewer moving parts than
          two loading states. */}
      <div className="mb-5 max-w-xs">
        <Select
          label="Academic year"
          options={academicYears.map((year) => ({ value: year.id, label: year.name }))}
          value={academicYearId}
          onChange={(event) => {
            router.push(
              `/dashboard/exams/criteria?academicYearId=${encodeURIComponent(event.target.value)}`,
            );
          }}
        />
      </div>

      {criteria.length === 0 ? (
        <p className="text-sm text-ink-muted">
          This school has no active classes, so there is nothing to set criteria
          for.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {criteria.map((row) => (
            <li key={row.gradeId} className="py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-ink">{row.gradeName}</p>
                  <p className="text-xs text-ink-muted">
                    {PROMOTION_MECHANISM_LABELS[row.mechanism]}
                    {row.minOverallPercentage === null
                      ? ''
                      : ` · at least ${row.minOverallPercentage}% overall`}
                    {row.maxFailedSubjects === null
                      ? ''
                      : ` · at most ${row.maxFailedSubjects} failed`}
                    {row.maxFailingSubjects === null
                      ? ''
                      : ` · at most ${row.maxFailingSubjects} in the failing sub-category`}
                    {row.minAttendancePercentage === null
                      ? ''
                      : ` · at least ${row.minAttendancePercentage}% attendance`}
                  </p>
                </div>

                <div className="flex flex-nowrap items-center gap-2 whitespace-nowrap">
                  {row.isConfigured ? null : <Badge variant="neutral">Default</Badge>}
                  {canWrite && editingGradeId !== row.gradeId ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setEditingGradeId(row.gradeId);
                        setDraft(toDraft(row));
                        setError(null);
                      }}
                    >
                      Edit
                    </Button>
                  ) : null}
                </div>
              </div>

              {editingGradeId === row.gradeId && draft !== null ? (
                <div className="mt-4 space-y-4 rounded-lg border border-line bg-surface-sunken p-4">
                  <fieldset>
                    <legend className="mb-2 text-sm font-medium text-ink">
                      How this class is judged
                    </legend>
                    <div className="flex flex-wrap gap-4">
                      {PROMOTION_MECHANISMS.map((mechanism) => (
                        <label
                          key={mechanism}
                          className="flex items-center gap-2 text-sm text-ink"
                        >
                          <input
                            type="radio"
                            name={`mechanism-${row.gradeId}`}
                            value={mechanism}
                            checked={draft.mechanism === mechanism}
                            onChange={() => {
                              setDraft((current) =>
                                current === null ? current : { ...current, mechanism },
                              );
                            }}
                          />
                          {PROMOTION_MECHANISM_LABELS[mechanism]}
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {draft.mechanism === 'marks_grades' ? (
                      <>
                        <Select
                          label="Grading scheme"
                          options={gradingSchemes.map((scheme) => ({
                            value: scheme.id,
                            label: scheme.name,
                          }))}
                          value={draft.gradingSchemeId}
                          placeholder="Use the school default"
                          onChange={(event) => {
                            const value = event.target.value;
                            setDraft((current) =>
                              current === null
                                ? current
                                : { ...current, gradingSchemeId: value },
                            );
                          }}
                        />
                        <Input
                          label="Minimum overall percentage"
                          type="number"
                          inputMode="decimal"
                          value={draft.minOverallPercentage}
                          hint="Blank means it is not applied."
                          onChange={(event) => {
                            const value = event.target.value;
                            setDraft((current) =>
                              current === null
                                ? current
                                : { ...current, minOverallPercentage: value },
                            );
                          }}
                        />
                        <Input
                          label="Failed subjects allowed"
                          type="number"
                          inputMode="numeric"
                          value={draft.maxFailedSubjects}
                          hint="Blank means no limit."
                          onChange={(event) => {
                            const value = event.target.value;
                            setDraft((current) =>
                              current === null
                                ? current
                                : { ...current, maxFailedSubjects: value },
                            );
                          }}
                        />
                      </>
                    ) : (
                      <>
                        <Select
                          label="Sub-category that counts as a fail"
                          options={subcategories.map((subcategory) => ({
                            value: subcategory.id,
                            label: subcategory.label,
                          }))}
                          value={draft.failingSubcategoryId}
                          placeholder="None — descriptors hold nobody back"
                          onChange={(event) => {
                            const value = event.target.value;
                            setDraft((current) =>
                              current === null
                                ? current
                                : { ...current, failingSubcategoryId: value },
                            );
                          }}
                        />
                        <Input
                          label="Failing subjects allowed"
                          type="number"
                          inputMode="numeric"
                          value={draft.maxFailingSubjects}
                          hint="Blank means no limit."
                          onChange={(event) => {
                            const value = event.target.value;
                            setDraft((current) =>
                              current === null
                                ? current
                                : { ...current, maxFailingSubjects: value },
                            );
                          }}
                        />
                      </>
                    )}

                    <Input
                      label="Minimum attendance percentage"
                      type="number"
                      inputMode="decimal"
                      value={draft.minAttendancePercentage}
                      hint="Blank means attendance is not a promotion factor."
                      onChange={(event) => {
                        const value = event.target.value;
                        setDraft((current) =>
                          current === null
                            ? current
                            : { ...current, minAttendancePercentage: value },
                        );
                      }}
                    />
                  </div>

                  {problem !== null ? (
                    <p className="text-sm text-status-danger-ink">{problem}</p>
                  ) : null}

                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      isLoading={busy === row.gradeId}
                      disabled={problem !== null}
                      onClick={() => {
                        void save(row.gradeId);
                      }}
                    >
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setEditingGradeId(null);
                        setDraft(null);
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
