'use client';

import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { CURRICULUM_LEVEL_LABELS, type CurriculumLevel } from '@/db/schema/branches';
import { getGradesForCurriculum } from '@/lib/predefined-grades';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * Grade and section setup for one branch and one academic year.
 *
 * A branch starts with no grades at all: the ladder is seeded from the platform
 * list for its curriculum, which is why the first thing shown is an "initialise"
 * button rather than an empty table. After that the school can rename each rung
 * for display and add the sections that actually exist this year.
 */

export interface GradeSetupGridProps {
  branchId: string;
  branchName: string;
  curriculumLevel: CurriculumLevel;
  academicYearId: string;
  academicYearName: string;
  canEdit: boolean;
}

interface GradeRow {
  id: string;
  name: string;
  displayName: string | null;
  label: string;
  sortOrder: number;
}

interface SectionRow {
  id: string;
  gradeId: string;
  name: string;
  capacity: number | null;
  studentCount: number;
}

export function GradeSetupGrid({
  branchId,
  branchName,
  curriculumLevel,
  academicYearId,
  academicYearName,
  canEdit,
}: GradeSetupGridProps) {
  const [grades, setGrades] = useState<GradeRow[] | null>(null);
  const [sections, setSections] = useState<SectionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const expected = getGradesForCurriculum(curriculumLevel);

  const loadGrades = useCallback(async () => {
    try {
      const payload = await schoolFetch<{ grades: GradeRow[] }>(
        `/api/school/grades?branchId=${encodeURIComponent(branchId)}`,
      );
      setGrades(payload.grades);
      setError(null);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not load grades.'));
    }
  }, [branchId]);

  const loadSections = useCallback(async () => {
    if (academicYearId === '') {
      setSections([]);
      return;
    }

    try {
      const payload = await schoolFetch<{ sections: SectionRow[] }>(
        `/api/school/sections?academicYearId=${encodeURIComponent(academicYearId)}`,
      );
      setSections(payload.sections);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not load sections.'));
    }
  }, [academicYearId]);

  useEffect(() => {
    void loadGrades();
    void loadSections();
  }, [loadGrades, loadSections]);

  const seed = async (): Promise<void> => {
    setBusy('seed');
    setError(null);

    try {
      await schoolFetch('/api/school/grades', {
        method: 'POST',
        body: JSON.stringify({ branchId }),
      });
      await loadGrades();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not initialise the grades.'));
    } finally {
      setBusy(null);
    }
  };

  const renameGrade = async (gradeId: string, displayName: string): Promise<void> => {
    setBusy(gradeId);

    try {
      await schoolFetch(`/api/school/grades/${gradeId}`, {
        method: 'PATCH',
        body: JSON.stringify({ displayName }),
      });
      await loadGrades();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not rename the grade.'));
    } finally {
      setBusy(null);
    }
  };

  const addSection = async (gradeId: string, name: string, capacity: string): Promise<void> => {
    setBusy(gradeId);
    setError(null);

    try {
      await schoolFetch('/api/school/sections', {
        method: 'POST',
        body: JSON.stringify({
          gradeId,
          academicYearId,
          name,
          capacity: capacity.trim() === '' ? null : Number(capacity),
        }),
      });
      await loadSections();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not add the section.'));
    } finally {
      setBusy(null);
    }
  };

  const removeSection = async (sectionId: string): Promise<void> => {
    setBusy(sectionId);
    setError(null);

    try {
      await schoolFetch(`/api/school/sections/${sectionId}`, { method: 'DELETE' });
      await loadSections();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not remove the section.'));
    } finally {
      setBusy(null);
    }
  };

  if (grades === null) {
    return (
      <Card>
        <p className="text-sm text-ink-muted">Loading grades…</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card
        header={
          <CardTitle
            title={branchName}
            description={`${CURRICULUM_LEVEL_LABELS[curriculumLevel]} · sections shown for ${
              academicYearName === '' ? 'no academic year' : academicYearName
            }`}
            action={
              canEdit && grades.length < expected.length ? (
                <Button
                  size="sm"
                  isLoading={busy === 'seed'}
                  onClick={() => {
                    void seed();
                  }}
                >
                  {grades.length === 0 ? 'Initialise grades' : 'Add missing grades'}
                </Button>
              ) : undefined
            }
          />
        }
      >
        {error !== null ? (
          <p role="alert" className="mb-4 rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
            {error}
          </p>
        ) : null}

        {grades.length === 0 ? (
          <p className="text-sm text-ink-muted">
            This branch has no grades yet. Initialising seeds the{' '}
            {expected.length} grades of the{' '}
            {CURRICULUM_LEVEL_LABELS[curriculumLevel]} ladder, from{' '}
            {expected[0]?.name} to {expected[expected.length - 1]?.name}. You can
            rename any of them afterwards.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {grades.map((grade) => (
              <GradeRowItem
                key={grade.id}
                grade={grade}
                sections={sections.filter((section) => section.gradeId === grade.id)}
                canEdit={canEdit && academicYearId !== ''}
                busy={busy === grade.id}
                onRename={renameGrade}
                onAddSection={addSection}
                onRemoveSection={removeSection}
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

interface GradeRowItemProps {
  grade: GradeRow;
  sections: readonly SectionRow[];
  canEdit: boolean;
  busy: boolean;
  onRename: (gradeId: string, displayName: string) => Promise<void>;
  onAddSection: (gradeId: string, name: string, capacity: string) => Promise<void>;
  onRemoveSection: (sectionId: string) => Promise<void>;
}

function GradeRowItem({
  grade,
  sections,
  canEdit,
  busy,
  onRename,
  onAddSection,
  onRemoveSection,
}: GradeRowItemProps) {
  const [displayName, setDisplayName] = useState(grade.displayName ?? '');
  const [isAdding, setIsAdding] = useState(false);
  const [sectionName, setSectionName] = useState('');
  const [capacity, setCapacity] = useState('');

  return (
    <li className="py-4">
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr_auto] sm:items-start">
        <div>
          <p className="text-sm font-medium text-ink">{grade.name}</p>
          <p className="text-xs text-ink-muted">Position {grade.sortOrder}</p>
        </div>

        <div className="space-y-3">
          {canEdit ? (
            <div className="flex items-end gap-2">
              <Input
                label="Display name"
                hideLabel
                placeholder={`Shown as "${grade.name}"`}
                value={displayName}
                disabled={busy}
                onChange={(event) => {
                  setDisplayName(event.target.value);
                }}
              />
              {displayName !== (grade.displayName ?? '') ? (
                <Button
                  size="sm"
                  variant="secondary"
                  isLoading={busy}
                  onClick={() => {
                    void onRename(grade.id, displayName);
                  }}
                >
                  Save
                </Button>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-ink-muted">{grade.label}</p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {sections.length === 0 ? (
              <span className="text-xs text-ink-muted">No sections yet</span>
            ) : (
              sections.map((section) => (
                <span
                  key={section.id}
                  className="inline-flex items-center gap-2 rounded-full bg-surface-sunken px-3 py-1 text-xs font-medium text-ink"
                >
                  {section.name} · {section.studentCount}
                  {section.capacity === null ? '' : `/${section.capacity}`}
                  {canEdit && section.studentCount === 0 ? (
                    <button
                      type="button"
                      aria-label={`Remove section ${section.name}`}
                      className="text-ink-muted hover:text-red-600"
                      onClick={() => {
                        void onRemoveSection(section.id);
                      }}
                    >
                      ×
                    </button>
                  ) : null}
                </span>
              ))
            )}
          </div>

          {isAdding ? (
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-28">
                <Input
                  label="Section"
                  hideLabel
                  placeholder="A"
                  value={sectionName}
                  disabled={busy}
                  onChange={(event) => {
                    setSectionName(event.target.value);
                  }}
                />
              </div>
              <div className="w-32">
                <Input
                  label="Capacity"
                  hideLabel
                  type="number"
                  min={1}
                  max={500}
                  placeholder="Capacity"
                  value={capacity}
                  disabled={busy}
                  onChange={(event) => {
                    setCapacity(event.target.value);
                  }}
                />
              </div>
              <Button
                size="sm"
                isLoading={busy}
                disabled={sectionName.trim() === ''}
                onClick={() => {
                  void onAddSection(grade.id, sectionName.trim(), capacity).then(() => {
                    setSectionName('');
                    setCapacity('');
                    setIsAdding(false);
                  });
                }}
              >
                Add
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setIsAdding(false);
                }}
              >
                Cancel
              </Button>
            </div>
          ) : null}
        </div>

        {canEdit && !isAdding ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setIsAdding(true);
            }}
          >
            Add section
          </Button>
        ) : null}
      </div>
    </li>
  );
}
