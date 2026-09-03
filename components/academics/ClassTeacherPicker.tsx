'use client';

import { useCallback, useEffect, useState } from 'react';

import { Card, CardTitle } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * Who runs this class — on the timetable screen (Sprint 23, item 4).
 *
 * ── Two doors to one column, on purpose ──────────────────────────────────
 * The same control is on `GradeSetupGrid`, and it was **not** moved. A school
 * that already sets its home-room teachers while setting up grades keeps that
 * workflow; what this adds is the door in the place the requirement named,
 * because a timetable is built per section and "whose class is this" is the
 * question somebody asks while looking at its week. Both write
 * `PATCH /api/school/sections/[sectionId]`, so neither can drift from the
 * other — there is one column and one route.
 *
 * ── One class teacher per section is structural ──────────────────────────
 * `sections.class_teacher_id` is one column. Assigning a second replaces the
 * first; a section can never have two, and there is nothing to add for that.
 *
 * ── One teacher may hold several sections ────────────────────────────────
 * Decision 4 of this sprint, so no uniqueness index and no refusal. What is
 * offered instead is the note — *also class teacher of 4-B* — beside the name,
 * which turns a surprise into a choice.
 */
export interface ClassTeacherPickerProps {
  /** Empty until a section is chosen; the card renders nothing until then. */
  sectionId: string;
  academicYearId: string;
  /**
   * How this very section is labelled — `5-A` — so a teacher who already holds
   * it is not told they "also" hold it. Built the same way the server builds
   * the labels it returns: the grade's display name, a hyphen, the section's.
   */
  sectionLabel: string;
  canEdit: boolean;
}

interface SectionRow {
  id: string;
  name: string;
  classTeacherId: string | null;
}

interface CandidateRow {
  id: string;
  name: string;
  designation: string | null;
  alsoClassTeacherOf: string[];
}

export function ClassTeacherPicker({
  sectionId,
  academicYearId,
  sectionLabel,
  canEdit,
}: ClassTeacherPickerProps) {
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [current, setCurrent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (sectionId === '' || academicYearId === '') return;

    setLoading(true);
    setError(null);
    try {
      /*
       * The same endpoint the setup grid uses, and the same list. Asking a
       * second route for "who may be a class teacher" is how the two screens
       * would come to disagree about a person.
       */
      const payload = await schoolFetch<{
        sections: SectionRow[];
        classTeachers: CandidateRow[];
      }>(`/api/school/sections?academicYearId=${encodeURIComponent(academicYearId)}`);

      setCandidates(payload.classTeachers);
      setCurrent(
        payload.sections.find((row) => row.id === sectionId)?.classTeacherId ?? '',
      );
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not load the class teacher.'));
    } finally {
      setLoading(false);
    }
  }, [sectionId, academicYearId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (next: string): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);

    const previous = current;
    setCurrent(next);

    try {
      await schoolFetch(`/api/school/sections/${sectionId}`, {
        method: 'PATCH',
        body: JSON.stringify({ classTeacherId: next === '' ? null : next }),
      });
      setNotice(
        next === ''
          ? 'This class has no class teacher.'
          : `${candidates.find((row) => row.id === next)?.name ?? 'That teacher'} is now the class teacher.`,
      );
      // Re-read: setting a teacher changes the "also class teacher of" notes
      // on every other row in the list, including this one.
      await load();
    } catch (caught) {
      setCurrent(previous);
      setError(schoolErrorMessage(caught, 'Could not set the class teacher.'));
    } finally {
      setBusy(false);
    }
  };

  if (sectionId === '') return null;

  return (
    <Card
      header={
        <CardTitle
          title="Class teacher"
          description="The home-room teacher for this section. They own its promotion decisions."
        />
      }
    >
      {error !== null ? (
        <p
          role="alert"
          className="mb-3 rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink"
        >
          {error}
        </p>
      ) : null}

      {notice !== null ? (
        <p className="mb-3 rounded-lg bg-status-success-subtle px-3 py-2 text-sm text-status-success-ink">
          {notice}
        </p>
      ) : null}

      <div className="max-w-md">
        <Select
          label="Class teacher"
          value={current}
          disabled={!canEdit || busy || loading}
          onChange={(event) => void save(event.target.value)}
          options={[
            {
              value: '',
              label: loading
                ? 'Loading…'
                : candidates.length === 0
                  ? 'No active staff to choose from'
                  : 'None',
            },
            ...candidates.map((candidate) => {
              const elsewhere = candidate.alsoClassTeacherOf.filter(
                (label) => label !== sectionLabel,
              );
              return {
                value: candidate.id,
                label:
                  candidate.name +
                  (candidate.designation === null ? '' : ` — ${candidate.designation}`) +
                  (elsewhere.length === 0
                    ? ''
                    : ` · also class teacher of ${elsewhere.join(', ')}`),
              };
            }),
          ]}
        />
      </div>
    </Card>
  );
}
