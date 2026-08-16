'use client';

import { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import {
  LESSON_PLAN_STATUS_LABELS,
  MAX_LESSON_PLAN_BODY,
  MAX_LESSON_PLAN_TITLE,
  type LessonPlanStatus,
} from '@/db/schema';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * A teacher's weekly lesson plans.
 *
 * ── Draft and Shared are two buttons, not a dropdown ─────────────────────
 * Saving a draft and sharing it with the school are different decisions, and a
 * status dropdown beside a Save button makes the second one something you can
 * do by accident while doing the first. Two buttons, each saying what it does.
 *
 * ── The week is always a Monday ──────────────────────────────────────────
 * Snapped on the client, enforced by the API and checked by the database. Three
 * places sounds like two too many; it is not. The input lets somebody type a
 * date, the API is reachable without the input, and the CHECK is what makes the
 * column mean what it says forever. Only the last of those is a guarantee.
 */

interface PlanRow {
  id: string;
  teacherId: string;
  teacherName: string;
  sectionId: string;
  sectionName: string;
  subjectId: string;
  subjectName: string;
  weekStarting: string;
  title: string;
  body: string;
  homework: string | null;
  status: LessonPlanStatus;
  updatedAt: string;
}

interface Option {
  id: string;
  label: string;
}

/** The Monday of the week a date falls in. Mirrors `weekStartingOf` server-side. */
function mondayOf(date: string): string {
  const at = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(at.getTime())) return date;
  at.setUTCDate(at.getUTCDate() - ((at.getUTCDay() + 6) % 7));
  return at.toISOString().slice(0, 10);
}

export function LessonPlanBoard({
  sections,
  subjects,
}: {
  sections: readonly Option[];
  subjects: readonly Option[];
}) {
  const [plans, setPlans] = useState<PlanRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  const [sectionId, setSectionId] = useState(sections[0]?.id ?? '');
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? '');
  const [week, setWeek] = useState(mondayOf(new Date().toISOString().slice(0, 10)));
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [homework, setHomework] = useState('');

  const load = async (): Promise<void> => {
    try {
      const payload = await schoolFetch<{ plans: PlanRow[] }>('/api/school/lesson-plans');
      setPlans(payload.plans);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not load your lesson plans.'));
      setPlans([]);
    }
  };

  useEffect(() => {
    // Loaded once on mount; every mutation below refreshes it explicitly.
    void load();
  }, []);

  const byWeek = useMemo(() => {
    const groups = new Map<string, PlanRow[]>();
    for (const plan of plans ?? []) {
      const existing = groups.get(plan.weekStarting);
      if (existing === undefined) groups.set(plan.weekStarting, [plan]);
      else existing.push(plan);
    }
    return [...groups.entries()].sort(([a], [b]) => (a < b ? 1 : -1));
  }, [plans]);

  const reset = (): void => {
    setTitle('');
    setBody('');
    setHomework('');
  };

  const save = async (status: LessonPlanStatus): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      await schoolFetch('/api/school/lesson-plans', {
        method: 'POST',
        body: JSON.stringify({
          sectionId,
          subjectId,
          weekStarting: mondayOf(week),
          title: title.trim(),
          body,
          homework: homework.trim() === '' ? null : homework.trim(),
          status,
        }),
      });
      setNotice(
        status === 'shared'
          ? 'Shared. Your coordinators and heads can see it.'
          : 'Saved as a draft. Only you can see it.',
      );
      reset();
      setIsOpen(false);
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not save that lesson plan.'));
    } finally {
      setBusy(false);
    }
  };

  const edit = (plan: PlanRow): void => {
    setSectionId(plan.sectionId);
    setSubjectId(plan.subjectId);
    setWeek(plan.weekStarting);
    setTitle(plan.title);
    setBody(plan.body);
    setHomework(plan.homework ?? '');
    setIsOpen(true);
    setNotice(null);
  };

  const remove = async (plan: PlanRow): Promise<void> => {
    if (!window.confirm(`Delete "${plan.title}"?`)) return;

    setBusy(true);
    setError(null);
    try {
      await schoolFetch(`/api/school/lesson-plans/${plan.id}`, { method: 'DELETE' });
      setNotice('Deleted.');
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not delete that lesson plan.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      header={
        <CardTitle
          title="My lesson plans"
          description="One plan per class, per subject, per week. Saving the same week again corrects it rather than adding a second."
          action={
            <Button
              size="sm"
              variant={isOpen ? 'secondary' : 'primary'}
              onClick={() => {
                setIsOpen(!isOpen);
                setNotice(null);
              }}
              disabled={sections.length === 0 || subjects.length === 0}
            >
              {isOpen ? 'Close' : 'New plan'}
            </Button>
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

      {notice !== null ? (
        <p className="mb-4 rounded-lg bg-status-success-subtle px-3 py-2 text-sm text-status-success-ink">
          {notice}
        </p>
      ) : null}

      {sections.length === 0 || subjects.length === 0 ? (
        <p className="text-sm text-ink-muted">
          You are not timetabled into a class and subject yet, so there is
          nothing to plan for.
        </p>
      ) : null}

      {isOpen ? (
        <div className="mb-6 space-y-4 rounded-lg border border-line bg-surface-sunken p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Select
              label="Class"
              value={sectionId}
              onChange={(event) => setSectionId(event.target.value)}
              options={sections.map((option) => ({
                value: option.id,
                label: option.label,
              }))}
            />
            <Select
              label="Subject"
              value={subjectId}
              onChange={(event) => setSubjectId(event.target.value)}
              options={subjects.map((option) => ({
                value: option.id,
                label: option.label,
              }))}
            />
            <Input
              label="Week beginning"
              type="date"
              value={week}
              onChange={(event) => setWeek(event.target.value)}
              onBlur={() => setWeek(mondayOf(week))}
              hint="Snapped to the Monday of that week."
            />
          </div>

          <Input
            label="Title"
            value={title}
            maxLength={MAX_LESSON_PLAN_TITLE}
            placeholder="Chapter 4 — Photosynthesis"
            onChange={(event) => setTitle(event.target.value)}
          />

          <Textarea
            label="The plan"
            value={body}
            rows={8}
            maxLength={MAX_LESSON_PLAN_BODY}
            placeholder={'Monday — recap of Chapter 3, introduce…\nTuesday — …'}
            onChange={(event) => setBody(event.target.value)}
            hint="Plain text. What you paste is stored and shown exactly as typed."
          />

          <Input
            label="Homework (optional)"
            value={homework}
            onChange={(event) => setHomework(event.target.value)}
          />

          <div className="flex flex-wrap gap-3">
            <Button
              variant="secondary"
              isLoading={busy}
              disabled={title.trim() === ''}
              onClick={() => void save('draft')}
            >
              Save draft
            </Button>
            <Button
              isLoading={busy}
              disabled={title.trim() === ''}
              onClick={() => void save('shared')}
            >
              Share with school
            </Button>
          </div>
        </div>
      ) : null}

      {plans === null ? (
        <p className="text-sm text-ink-muted">Loading your lesson plans…</p>
      ) : plans.length === 0 ? (
        <EmptyState
          bare
          title="No lesson plans yet"
          description="Plans for the eight weeks either side of this one appear here."
        />
      ) : (
        <div className="space-y-6">
          {byWeek.map(([weekStarting, rows]) => (
            <section key={weekStarting}>
              <h3 className="text-sm font-semibold text-ink">
                Week beginning {weekStarting}
              </h3>
              <ul className="mt-2 divide-y divide-line">
                {rows.map((plan) => (
                  <li key={plan.id} className="py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-ink">{plan.title}</p>
                        <p className="text-xs text-ink-muted">
                          {plan.subjectName} · {plan.sectionName}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant={plan.status === 'shared' ? 'success' : 'neutral'}>
                          {LESSON_PLAN_STATUS_LABELS[plan.status]}
                        </Badge>
                        <Button size="sm" variant="ghost" onClick={() => edit(plan)}>
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => void remove(plan)}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>

                    {plan.body === '' ? null : (
                      <p className="mt-2 whitespace-pre-wrap text-sm text-ink-muted">
                        {plan.body}
                      </p>
                    )}

                    {plan.homework === null || plan.homework === '' ? null : (
                      <p className="mt-2 text-sm text-ink">
                        <span className="font-medium">Homework: </span>
                        {plan.homework}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Card>
  );
}
