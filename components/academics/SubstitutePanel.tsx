'use client';

import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { formatTimeOfDay } from '@/db/schema/timetable-slots';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * Teacher availability and quick substitutes. Sprint 33c, C4.
 *
 * ── Three steps, in the order the question is actually asked ─────────────
 * A head does not open this thinking "who is free at 09:05". They open it
 * because somebody has rung in ill, so: **which day**, **whose class**, **which
 * period** — and only then does the list of people who could take it mean
 * anything. Each step fetches the next, which is also why the route answers
 * all three shapes.
 *
 * ── Who is *not* free is shown, with the reason ──────────────────────────
 * A panel that shows only the free list answers "who can do it" and refuses to
 * answer "why not her" — and the second question is the one a head asks when
 * the name they had in mind is missing. "On Casual Leave" and "Teaching Year 4
 * — B, Period 3 (09:05 – 09:45)" are both actionable; an absence from a list
 * is not.
 *
 * ── Every fetch has a visible pending state ──────────────────────────────
 * CLAUDE.md's standing rule: `loading.tsx` covers the server render and
 * anything a client component fetches after mount carries its own. There are
 * three here — the day, the availability and the send — and they are separate
 * flags because they are separate waits, and one shared spinner would grey out
 * a list that is already correct.
 */

interface SectionOption {
  id: string;
  label: string;
}

interface LessonRow {
  entryId: string | null;
  slotId: string;
  slotName: string;
  startTime: string;
  endTime: string;
  isBreak: boolean;
  subjectName: string | null;
  teacherId: string | null;
  teacherName: string | null;
  coverTeacherId: string | null;
  coverTeacherName: string | null;
  substitutionId: string | null;
}

interface AvailabilityRow {
  schoolUserId: string;
  name: string;
  branchName: string | null;
  free: boolean;
  reason: string | null;
}

interface Availability {
  date: string;
  slot: { id: string; name: string; startTime: string; endTime: string };
  free: AvailabilityRow[];
  busy: AvailabilityRow[];
}

interface DayResponse {
  date: string;
  sections: SectionOption[];
  lessons?: LessonRow[];
  availability?: Availability;
}

/** Today, as the date input means it. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function SubstitutePanel() {
  const [date, setDate] = useState(today);
  const [sections, setSections] = useState<SectionOption[] | null>(null);
  const [sectionId, setSectionId] = useState('');
  const [lessons, setLessons] = useState<LessonRow[]>([]);
  const [slotId, setSlotId] = useState<string | null>(null);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [note, setNote] = useState('');

  const [loadingDay, setLoadingDay] = useState(false);
  const [loadingFree, setLoadingFree] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showBusy, setShowBusy] = useState(false);

  const loadDay = useCallback(async (): Promise<void> => {
    setLoadingDay(true);
    setError(null);
    setNotice(null);

    try {
      const params = new URLSearchParams({ date });
      if (sectionId !== '') params.set('sectionId', sectionId);

      const result = await schoolFetch<DayResponse>(
        `/api/school/timetable/substitutes?${params.toString()}`,
      );

      setSections(result.sections);
      setLessons(result.lessons ?? []);
      setSlotId(null);
      setAvailability(null);
    } catch (caught) {
      setSections((held) => held ?? []);
      setLessons([]);
      setError(schoolErrorMessage(caught, 'The day could not be read.'));
    } finally {
      setLoadingDay(false);
    }
  }, [date, sectionId]);

  useEffect(() => {
    void loadDay();
  }, [loadDay]);

  const findCover = async (wantedSlotId: string): Promise<void> => {
    setLoadingFree(true);
    setError(null);
    setNotice(null);
    setSlotId(wantedSlotId);
    setAvailability(null);
    setShowBusy(false);

    try {
      const params = new URLSearchParams({ date, sectionId, slotId: wantedSlotId });
      const result = await schoolFetch<DayResponse>(
        `/api/school/timetable/substitutes?${params.toString()}`,
      );
      setAvailability(result.availability ?? null);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Nobody could be checked for that period.'));
    } finally {
      setLoadingFree(false);
    }
  };

  const send = async (coverTeacherId: string, name: string): Promise<void> => {
    if (slotId === null) return;

    setSending(coverTeacherId);
    setError(null);
    setNotice(null);

    try {
      await schoolFetch('/api/school/timetable/substitutes', {
        method: 'POST',
        body: JSON.stringify({
          date,
          sectionId,
          slotId,
          coverTeacherId,
          note: note.trim() === '' ? null : note.trim(),
        }),
      });

      setNotice(`${name} has been asked to cover, and has been told.`);
      setNote('');
      // Re-read the day so the cover appears against the period it is for.
      // `router.refresh()` is deliberately not used: on a hard-loaded page it
      // does nothing, which is `STATE.md`'s most-rediscovered fact.
      await loadDay();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'The cover could not be arranged.'));
    } finally {
      setSending(null);
    }
  };

  const chosen = lessons.find((row) => row.slotId === slotId) ?? null;

  return (
    <Card
      className="p-0"
      header={
        <CardTitle
          title="Cover for the day"
          description="Who is free to take a period, and asking them. A substitution is for one date — it does not change the timetable."
        />
      }
    >
      <div className="space-y-4 px-5 py-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            type="date"
            label="Date"
            value={date}
            onChange={(event) => {
              setDate(event.target.value);
            }}
          />
          <Select
            label="Class"
            placeholder={sections === null ? 'Loading…' : 'Choose a class'}
            value={sectionId}
            options={(sections ?? []).map((row) => ({ value: row.id, label: row.label }))}
            onChange={(event) => {
              setSectionId(event.target.value);
            }}
          />
        </div>

        {error === null ? null : (
          <p className="rounded-card bg-status-danger-surface px-3 py-2 text-sm text-status-danger-ink">
            {error}
          </p>
        )}

        {notice === null ? null : (
          <p className="rounded-card bg-status-success-surface px-3 py-2 text-sm text-status-success-ink">
            {notice}
          </p>
        )}

        {loadingDay ? (
          <p className="text-sm text-ink-muted">Reading the day…</p>
        ) : sectionId === '' ? (
          <p className="text-sm text-ink-muted">
            Choose a class to see its periods for that day.
          </p>
        ) : lessons.length === 0 ? (
          <p className="text-sm text-ink-muted">
            Nothing is timetabled for that class on that day.
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-card border border-line">
            {lessons.map((lesson) => (
              <li
                key={lesson.slotId}
                className="flex flex-wrap items-center justify-between gap-3 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">
                    {lesson.slotName}{' '}
                    <span className="font-normal text-ink-muted">
                      ({formatTimeOfDay(lesson.startTime)} –{' '}
                      {formatTimeOfDay(lesson.endTime)})
                    </span>
                  </p>
                  <p className="text-xs text-ink-muted">
                    {lesson.subjectName ?? 'No lesson'}
                    {lesson.teacherName === null ? '' : ` · ${lesson.teacherName}`}
                  </p>
                  {lesson.coverTeacherName === null ? null : (
                    <p className="mt-1">
                      <Badge variant="success">
                        Covered by {lesson.coverTeacherName}
                      </Badge>
                    </p>
                  )}
                </div>

                <Button
                  size="sm"
                  variant={lesson.slotId === slotId ? 'primary' : 'secondary'}
                  isLoading={loadingFree && lesson.slotId === slotId}
                  onClick={() => {
                    void findCover(lesson.slotId);
                  }}
                >
                  {lesson.coverTeacherName === null ? 'Find cover' : 'Change cover'}
                </Button>
              </li>
            ))}
          </ul>
        )}

        {slotId === null || availability === null ? null : (
          <div className="space-y-3 rounded-card border border-line p-3">
            <p className="text-sm font-medium text-ink">
              Free in {availability.slot.name} (
              {formatTimeOfDay(availability.slot.startTime)} –{' '}
              {formatTimeOfDay(availability.slot.endTime)})
              {chosen?.teacherName === null || chosen === null
                ? ''
                : `, covering for ${chosen.teacherName}`}
            </p>

            <Input
              label="Note for the teacher (optional)"
              value={note}
              maxLength={280}
              onChange={(event) => {
                setNote(event.target.value);
              }}
            />

            {availability.free.length === 0 ? (
              <p className="text-sm text-ink-muted">
                Nobody in your reach is free in that period. Widening it is a
                permissions question — the people you can ask are the ones who
                report to you.
              </p>
            ) : (
              <ul className="space-y-2">
                {availability.free.map((teacher) => (
                  <li
                    key={teacher.schoolUserId}
                    className="flex flex-wrap items-center justify-between gap-2"
                  >
                    <span className="text-sm text-ink">
                      {teacher.name}
                      {teacher.branchName === null ? null : (
                        <span className="text-ink-muted"> · {teacher.branchName}</span>
                      )}
                    </span>
                    <Button
                      size="sm"
                      isLoading={sending === teacher.schoolUserId}
                      onClick={() => {
                        void send(teacher.schoolUserId, teacher.name);
                      }}
                    >
                      Send as substitute
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            {availability.busy.length === 0 ? null : (
              <div>
                <button
                  type="button"
                  className="text-sm font-medium text-brand-primary hover:underline"
                  onClick={() => {
                    setShowBusy(!showBusy);
                  }}
                >
                  {showBusy ? 'Hide' : 'Show'} the {availability.busy.length} who are
                  not free
                </button>

                {showBusy ? (
                  <ul className="mt-2 space-y-1">
                    {availability.busy.map((teacher) => (
                      <li key={teacher.schoolUserId} className="text-xs text-ink-muted">
                        <span className="font-medium text-ink">{teacher.name}</span> —{' '}
                        {teacher.reason ?? 'not available'}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
