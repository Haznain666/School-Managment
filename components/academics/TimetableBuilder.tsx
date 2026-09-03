'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@/components/ui/Table';
import { subjectShortLabel } from '@/db/schema/subjects';
import { formatTimeOfDay } from '@/db/schema/timetable-slots';
import { WEEKDAY_NAMES, WEEKDAY_SHORT_NAMES } from '@/db/schema/timetable-entries';
import { ClassTeacherPicker } from '@/components/academics/ClassTeacherPicker';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';
import { readableForeground } from '@/lib/color-contrast';

/**
 * The weekly timetable builder.
 *
 * The grid is the whole point: a school does not think about a lesson at a
 * time, it thinks about a week, and the clashes it is trying to avoid are only
 * visible when the week is on one screen. Rows are the school's bell schedule
 * so every section is laid out the same way, and breaks span the full width
 * because nothing is taught across them.
 *
 * Saving a cell is an upsert, so replacing a lesson is one request rather than
 * a delete followed by an insert that could leave the cell empty.
 *
 * ── The rows are the section's own schedule ──────────────────────────────
 * Not the school's whole bell schedule: the schedule assigned to this section's
 * *grade*, or the school default when nobody has assigned it. So the grid for
 * Pre-Nursery A shows three long periods and the grid for Class 10 A shows
 * eight short ones, from the same screen. The schedule's name is printed above
 * the grid — a grid whose rows changed when the grade was reassigned, with
 * nothing saying which schedule it is now showing, reads as data loss.
 */

export interface TimetableYearOption {
  id: string;
  name: string;
  isActive: boolean;
}

export interface TimetableGradeOption {
  id: string;
  label: string;
}

export interface TimetableSectionOption {
  id: string;
  gradeId: string;
  academicYearId: string;
  name: string;
}

export interface TimetableSubjectOption {
  id: string;
  name: string;
  code: string | null;
  color: string | null;
}

export interface TimetableTeacherOption {
  id: string;
  name: string;
}

export interface TimetableBuilderProps {
  academicYears: readonly TimetableYearOption[];
  grades: readonly TimetableGradeOption[];
  sections: readonly TimetableSectionOption[];
  subjects: readonly TimetableSubjectOption[];
  teachers: readonly TimetableTeacherOption[];
  /**
   * `admissions.write` — whether the class-teacher control may be used.
   *
   * A *different* key from the one that gates the grid itself
   * (`academics.write`), because it writes a *different* column through a
   * different route: `PATCH /api/school/sections/[sectionId]`. Somebody who may
   * build a timetable and not restructure classes sees the control disabled
   * rather than absent, because it is showing them a fact — who the class
   * teacher is — that they are entitled to read.
   */
  canManageClassTeacher: boolean;
  /**
   * Bumped by the schedule editor below the grid, to force a refetch.
   *
   * A counter rather than the payload itself: the builder still has to be able
   * to refetch after saving a lesson, which is the far more common action, and
   * a parent that owned the data would have to be told about that too.
   */
  reloadKey?: number;
}

interface SlotRow {
  id: string;
  periodStructureId: string;
  name: string;
  startTime: string;
  endTime: string;
  isBreak: boolean;
  orderIndex: number;
}

interface EntryRow {
  id: string;
  slotId: string;
  dayOfWeek: number;
  room: string | null;
  subjectId: string;
  subjectName: string;
  subjectCode: string | null;
  subjectColor: string | null;
  teacherId: string;
  teacherName: string;
}

interface StructureRow {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
}

interface TimetablePayload {
  slots: SlotRow[];
  entries: EntryRow[];
  /** Null when the school has no bell schedule at all. */
  structure: StructureRow | null;
}

interface EditingCell {
  slot: SlotRow;
  dayOfWeek: number;
  entry: EntryRow | null;
  subjectId: string;
  teacherId: string;
  room: string;
}


/** Used when a subject has no colour of its own. */
const SUBJECT_FALLBACK = '#475569';

/** The key an entry occupies in the grid. */
function cellKey(slotId: string, dayOfWeek: number): string {
  return `${slotId}:${dayOfWeek}`;
}

export function TimetableBuilder({
  academicYears,
  grades,
  sections,
  subjects,
  teachers,
  canManageClassTeacher,
  reloadKey = 0,
}: TimetableBuilderProps) {
  const activeYear = academicYears.find((year) => year.isActive) ?? academicYears[0];

  const [yearId, setYearId] = useState(activeYear?.id ?? '');
  const [gradeId, setGradeId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [payload, setPayload] = useState<TimetablePayload | null>(null);
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const sectionOptions = useMemo(
    () =>
      sections
        .filter(
          (section) => section.academicYearId === yearId && section.gradeId === gradeId,
        )
        .map((section) => ({ value: section.id, label: section.name })),
    [sections, yearId, gradeId],
  );

  // A section belongs to one grade in one year, so changing either selector
  // above it can leave the chosen section pointing at another class.
  useEffect(() => {
    if (sectionId !== '' && !sectionOptions.some((option) => option.value === sectionId)) {
      setSectionId('');
      setPayload(null);
    }
  }, [sectionOptions, sectionId]);

  const load = useCallback(async () => {
    if (yearId === '' || sectionId === '') {
      setPayload(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const data = await schoolFetch<TimetablePayload>(
        // `v` carries the reload counter into the URL, which is both how this
        // callback legitimately depends on it and what stops the browser
        // answering a refetch-after-write from its own heuristic cache.
        `/api/school/timetable/entries?sectionId=${sectionId}&academicYearId=${yearId}&v=${reloadKey}`,
      );
      setPayload(data);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not load the timetable.'));
      setPayload(null);
    } finally {
      setIsLoading(false);
    }
  }, [yearId, sectionId, reloadKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const entriesByCell = useMemo(() => {
    const map = new Map<string, EntryRow>();
    for (const entry of payload?.entries ?? []) {
      map.set(cellKey(entry.slotId, entry.dayOfWeek), entry);
    }
    return map;
  }, [payload]);

  /*
   * Lessons this grid cannot draw, because they sit in periods that belong to a
   * different schedule.
   *
   * This happens for one reason and it is a reason a school will hit: somebody
   * moved the grade onto another period schedule after its week was built. The
   * lessons are not lost — they are still filed against the old schedule's
   * periods, and moving the grade back shows them again — but a grid that
   * silently went blank is indistinguishable from one that lost the term's
   * work, and the person looking at it has no way to tell which happened.
   *
   * So it is counted and said out loud. Deliberately not auto-migrated: the two
   * schedules have different periods at different times, and there is no honest
   * mapping from "period 3 of the senior day" to anything in the junior one.
   */
  const strandedCount = useMemo(() => {
    if (payload === null) return 0;
    const drawable = new Set(payload.slots.map((slot) => slot.id));
    return payload.entries.filter((entry) => !drawable.has(entry.slotId)).length;
  }, [payload]);

  const openCell = (slot: SlotRow, dayOfWeek: number): void => {
    const entry = entriesByCell.get(cellKey(slot.id, dayOfWeek)) ?? null;

    setError(null);
    setEditing({
      slot,
      dayOfWeek,
      entry,
      subjectId: entry?.subjectId ?? subjects[0]?.id ?? '',
      teacherId: entry?.teacherId ?? teachers[0]?.id ?? '',
      room: entry?.room ?? '',
    });
  };

  const save = async (): Promise<void> => {
    if (editing === null) return;

    if (editing.subjectId === '' || editing.teacherId === '') {
      setError('Choose both a subject and a teacher.');
      return;
    }

    setBusy('save');
    setError(null);

    try {
      await schoolFetch('/api/school/timetable/entries', {
        method: 'POST',
        body: JSON.stringify({
          academicYearId: yearId,
          sectionId,
          subjectId: editing.subjectId,
          teacherId: editing.teacherId,
          slotId: editing.slot.id,
          dayOfWeek: editing.dayOfWeek,
          room: editing.room.trim(),
        }),
      });

      setEditing(null);
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not save the lesson.'));
    } finally {
      setBusy(null);
    }
  };

  const clear = async (): Promise<void> => {
    if (editing === null || editing.entry === null) return;

    setBusy('clear');
    setError(null);

    try {
      await schoolFetch(`/api/school/timetable/entries/${editing.entry.id}`, {
        method: 'DELETE',
      });

      setEditing(null);
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not clear the lesson.'));
    } finally {
      setBusy(null);
    }
  };

  const slots = payload?.slots ?? [];

  return (
    <div className="space-y-4">
      <Card header={<CardTitle title="Choose a class" />}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Select
            label="Academic year"
            options={academicYears.map((year) => ({ value: year.id, label: year.name }))}
            value={yearId}
            placeholder="Select a year"
            onChange={(event) => {
              setYearId(event.target.value);
              setSectionId('');
              setPayload(null);
            }}
          />
          <Select
            label="Grade"
            options={grades.map((grade) => ({ value: grade.id, label: grade.label }))}
            value={gradeId}
            placeholder="Select a grade"
            onChange={(event) => {
              setGradeId(event.target.value);
              setSectionId('');
              setPayload(null);
            }}
          />
          <Select
            label="Section"
            options={sectionOptions}
            value={sectionId}
            placeholder={
              gradeId === '' ? 'Choose a grade first' : 'Select a section'
            }
            disabled={sectionOptions.length === 0}
            onChange={(event) => {
              setSectionId(event.target.value);
            }}
          />
        </div>
      </Card>

      {/*
        Sprint 23, item 4 — the class teacher, on the screen the class's week is
        built on. Rendered under the selectors and above the grid because it is
        a fact about the section rather than about a period, and it disappears
        with the selectors when no section is chosen.
      */}
      <ClassTeacherPicker
        sectionId={sectionId}
        academicYearId={yearId}
        sectionLabel={`${grades.find((grade) => grade.id === gradeId)?.label ?? ''}-${
          sections.find((section) => section.id === sectionId)?.name ?? ''
        }`}
        canEdit={canManageClassTeacher}
      />

      {error !== null && editing === null ? (
        <p role="alert" className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}

      {strandedCount === 0 ? null : (
        <p className="rounded-lg bg-status-warning-subtle px-3 py-2 text-sm text-status-warning-onSubtle">
          {strandedCount} lesson{strandedCount === 1 ? '' : 's'} for this class{' '}
          {strandedCount === 1 ? 'is' : 'are'} filed against a different period
          schedule and cannot be shown here. Nothing has been deleted — this
          grade was moved onto{' '}
          <span className="font-medium">
            {payload?.structure?.name ?? 'another schedule'}
          </span>
          , whose periods are different ones. Move the grade back to see them
          again, or rebuild the week against these periods.
        </p>
      )}

      {sectionId === '' ? (
        <Card>
          <p className="text-sm text-ink-muted">
            Choose a year, grade and section to build its week.
          </p>
        </Card>
      ) : isLoading ? (
        <Card>
          <p className="text-sm text-ink-muted">Loading the timetable…</p>
        </Card>
      ) : slots.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-muted">
            This class has no periods yet, so there is no grid to fill. Add
            them to its period schedule below and the week will appear.
          </p>
        </Card>
      ) : subjects.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-muted">
            No subjects have been created yet — there is nothing to place in the
            grid.
          </p>
        </Card>
      ) : (
        <Card className="p-0">
          {payload?.structure === null || payload?.structure === undefined ? null : (
            <p className="border-b border-line px-4 py-2.5 text-xs text-ink-muted">
              Laid out against{' '}
              <span className="font-medium text-ink">{payload.structure.name}</span>
              {payload.structure.isDefault
                ? ' — the school default, which every unassigned grade uses.'
                : '.'}
            </p>
          )}

          <div className="overflow-x-auto">
            <Table caption="Weekly timetable" className="rounded-none border-0">
              <TableHead>
                <TableRow>
                  <TableHeaderCell className="w-40">Period</TableHeaderCell>
                  {WEEKDAY_SHORT_NAMES.map((day) => (
                    <TableHeaderCell key={day}>
                      {day}
                    </TableHeaderCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {slots.map((slot) => (
                  <TableRow key={slot.id}>
                    <TableCell rowHeader>
                      <span className="block font-medium text-ink">
                        {slot.name}
                      </span>
                      <span className="block text-xs font-normal text-ink-muted">
                        {formatTimeOfDay(slot.startTime)} –{' '}
                        {formatTimeOfDay(slot.endTime)}
                      </span>
                    </TableCell>

                    {slot.isBreak ? (
                      // Nothing is taught across a break, so it reads as one
                      // band rather than five empty cells inviting a click.
                      <TableCell align="center" muted className="bg-surface-sunken text-center text-xs uppercase tracking-wide" colSpan={WEEKDAY_SHORT_NAMES.length}>
                        {slot.name}
                      </TableCell>
                    ) : (
                      WEEKDAY_SHORT_NAMES.map((_day, dayIndex) => {
                        const entry = entriesByCell.get(cellKey(slot.id, dayIndex));

                        return (
                          <TableCell key={`${slot.id}-${dayIndex}`}>
                            <button
                              type="button"
                              onClick={() => {
                                openCell(slot, dayIndex);
                              }}
                              className={
                                entry === undefined
                                  ? 'flex h-[4.5rem] w-full items-center justify-center rounded-lg border border-dashed border-line-strong text-xs text-ink-muted transition hover:border-brand-primary hover:text-brand-primary'
                                  : 'flex h-[4.5rem] w-full flex-col justify-center gap-0.5 rounded-lg px-2 py-1.5 text-left transition hover:opacity-90'
                              }
                              style={
                                entry === undefined
                                  ? undefined
                                  : {
                                      backgroundColor: entry.subjectColor ?? SUBJECT_FALLBACK,
                                      // Computed, not assumed white -- a school
                                      // may colour a subject pale. See
                                      // TimetableGrid for the same fix.
                                      color: readableForeground(
                                        entry.subjectColor ?? SUBJECT_FALLBACK,
                                      ),
                                    }
                              }
                            >
                              {entry === undefined ? (
                                <span>+ Add</span>
                              ) : (
                                <>
                                  <span className="truncate text-xs font-semibold">
                                    {subjectShortLabel({
                                      name: entry.subjectName,
                                      code: entry.subjectCode,
                                    })}
                                  </span>
                                  <span className="truncate text-[11px] opacity-90">
                                    {entry.teacherName}
                                  </span>
                                  {entry.room === null || entry.room === '' ? null : (
                                    <span className="truncate text-[11px] opacity-75">
                                      {entry.room}
                                    </span>
                                  )}
                                </>
                              )}
                            </button>
                          </TableCell>
                        );
                      })
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {editing === null ? null : (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${editing.slot.name}, ${WEEKDAY_NAMES[editing.dayOfWeek] ?? ''}`}
          className="fixed inset-0 z-40 flex items-center justify-center bg-[rgb(2_6_23/0.55)] p-4"
        >
          <div className="w-full max-w-lg">
            <Card
              header={
                <CardTitle
                  title={`${editing.slot.name} · ${WEEKDAY_NAMES[editing.dayOfWeek] ?? ''}`}
                  description={`${formatTimeOfDay(editing.slot.startTime)} – ${formatTimeOfDay(editing.slot.endTime)}`}
                />
              }
            >
              <div className="space-y-4">
                <Select
                  label="Subject"
                  options={subjects.map((subject) => ({
                    value: subject.id,
                    label: subject.name,
                  }))}
                  value={editing.subjectId}
                  placeholder="Select a subject"
                  onChange={(event) => {
                    setEditing({ ...editing, subjectId: event.target.value });
                  }}
                />

                <Select
                  label="Teacher"
                  options={teachers.map((teacher) => ({
                    value: teacher.id,
                    label: teacher.name,
                  }))}
                  value={editing.teacherId}
                  placeholder="Select a teacher"
                  onChange={(event) => {
                    setEditing({ ...editing, teacherId: event.target.value });
                  }}
                />

                <Input
                  label="Room"
                  value={editing.room}
                  maxLength={40}
                  placeholder="Room 12"
                  hint="Optional. Leave blank for the section's usual room."
                  onChange={(event) => {
                    setEditing({ ...editing, room: event.target.value });
                  }}
                />

                {error !== null ? (
                  <p
                    role="alert"
                    className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink"
                  >
                    {error}
                  </p>
                ) : null}
              </div>

              <div className="mt-5 flex flex-wrap gap-3">
                <Button
                  isLoading={busy === 'save'}
                  onClick={() => {
                    void save();
                  }}
                >
                  Save lesson
                </Button>

                {editing.entry === null ? null : (
                  <Button
                    variant="danger"
                    isLoading={busy === 'clear'}
                    onClick={() => {
                      void clear();
                    }}
                  >
                    Clear
                  </Button>
                )}

                <Button
                  variant="ghost"
                  onClick={() => {
                    setEditing(null);
                    setError(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
