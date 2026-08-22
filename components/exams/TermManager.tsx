'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { TERM_NAME_MAX } from '@/db/schema/exam-terms';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * Exam terms — the unit a report card is issued for.
 *
 * ── The dates are optional, and the list still has an order ──────────────
 * From Sprint 14 the authoritative dates live on each term's schedules, where
 * they differ per grade. A term-level window is an envelope a school may fill
 * in for its calendar and may leave blank, so the list is ordered by
 * `sequence_order` — a school's own reading order — and not by a date that may
 * not exist. Where the envelope is blank the row shows the window derived from
 * the schedules, which is what `windowStart`/`windowEnd` carry.
 *
 * ── Reorder writes the whole list ────────────────────────────────────────
 * One request per move, carrying every term's new position. Sending only the
 * two rows that swapped would leave the sequence to be repaired by whichever
 * request arrived second, and two people reordering at once would produce a
 * list neither of them asked for.
 *
 * Publishing is the one control here a parent sees the effect of, so it stays
 * a separate, deliberate action: pressing it issues every report card for that
 * term at once.
 */

export interface TermRow {
  id: string;
  name: string;
  academicYearId: string;
  academicYearName: string;
  startDate: string | null;
  endDate: string | null;
  windowStart: string;
  windowEnd: string;
  sequenceOrder: number;
  gradingSchemeId: string | null;
  isPublished: boolean;
  examCount: number;
  scheduleCount: number;
}

export interface TermManagerProps {
  terms: readonly TermRow[];
  academicYears: readonly { id: string; name: string; isActive: boolean }[];
  gradingSchemes: readonly { id: string; name: string }[];
  canWrite: boolean;
  canPublish: boolean;
}

interface EditDraft {
  name: string;
  startDate: string;
  endDate: string;
  gradingSchemeId: string;
}

export function TermManager({
  terms,
  academicYears,
  gradingSchemes,
  canWrite,
  canPublish,
}: TermManagerProps) {
  const router = useRouter();
  const activeYear = academicYears.find((year) => year.isActive) ?? academicYears[0];

  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState('');
  const [yearId, setYearId] = useState(activeYear?.id ?? '');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [schemeId, setSchemeId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditDraft>({
    name: '',
    startDate: '',
    endDate: '',
    gradingSchemeId: '',
  });

  const create = async (): Promise<void> => {
    setIsSaving(true);
    setError(null);

    try {
      await schoolFetch('/api/school/exam-terms', {
        method: 'POST',
        body: JSON.stringify({
          name,
          academicYearId: yearId,
          // Blank is a real answer here, not a missing one: the term takes its
          // window from its schedules.
          startDate: startDate === '' ? null : startDate,
          endDate: endDate === '' ? null : endDate,
          gradingSchemeId: schemeId === '' ? null : schemeId,
        }),
      });

      setIsOpen(false);
      setName('');
      setStartDate('');
      setEndDate('');
      setSchemeId('');
      router.refresh();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'The term could not be created.'));
    } finally {
      setIsSaving(false);
    }
  };

  const patch = async (termId: string, body: Record<string, unknown>): Promise<void> => {
    setBusyId(termId);
    setError(null);

    try {
      await schoolFetch(`/api/school/exam-terms/${termId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setEditingId(null);
      router.refresh();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'The term could not be updated.'));
    } finally {
      setBusyId(null);
    }
  };

  const archive = async (term: TermRow): Promise<void> => {
    const confirmed = window.confirm(
      `Archive "${term.name}"? Its schedules and generated exams are archived with it. ` +
        'Nothing is deleted — report cards already issued keep rendering.',
    );
    if (!confirmed) return;

    setBusyId(term.id);
    setError(null);

    try {
      await schoolFetch(`/api/school/exam-terms/${term.id}`, { method: 'DELETE' });
      router.refresh();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'The term could not be archived.'));
    } finally {
      setBusyId(null);
    }
  };

  const move = async (termId: string, direction: -1 | 1): Promise<void> => {
    const index = terms.findIndex((term) => term.id === termId);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= terms.length) return;

    const reordered = [...terms];
    const [moved] = reordered.splice(index, 1);
    if (moved === undefined) return;
    reordered.splice(target, 0, moved);

    setBusyId(termId);
    setError(null);

    try {
      await schoolFetch('/api/school/exam-terms/reorder', {
        method: 'PATCH',
        body: JSON.stringify({
          terms: reordered.map((term, position) => ({
            id: term.id,
            sequenceOrder: position + 1,
          })),
        }),
      });
      router.refresh();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'The terms could not be reordered.'));
    } finally {
      setBusyId(null);
    }
  };

  const remaining = TERM_NAME_MAX - name.trim().length;

  return (
    <Card
      header={
        <CardTitle
          title="Exam terms"
          description="A term is what a report card is issued for. Its dates come from its schedules."
          action={
            canWrite ? (
              <Button
                size="sm"
                variant={isOpen ? 'secondary' : 'primary'}
                onClick={() => {
                  setIsOpen((open) => !open);
                }}
              >
                {isOpen ? 'Cancel' : 'New term'}
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

      {isOpen ? (
        <div className="mb-5 space-y-4 rounded-lg border border-line bg-surface-sunken p-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <Input
              label="Term name"
              value={name}
              maxLength={TERM_NAME_MAX}
              placeholder="First Term"
              hint={`${remaining} character${remaining === 1 ? '' : 's'} left`}
              error={remaining < 0 ? `Keep it to ${TERM_NAME_MAX} characters.` : undefined}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
            <Select
              label="Academic year"
              options={academicYears.map((year) => ({
                value: year.id,
                label: year.name,
              }))}
              value={yearId}
              placeholder="Select a year"
              onChange={(event) => {
                setYearId(event.target.value);
              }}
            />
            <Select
              label="Grading scheme"
              options={gradingSchemes.map((scheme) => ({
                value: scheme.id,
                label: scheme.name,
              }))}
              value={schemeId}
              placeholder="Use the school default"
              hint="Leave this to use the default scheme."
              onChange={(event) => {
                setSchemeId(event.target.value);
              }}
            />
            <Input
              label="Starts (optional)"
              type="date"
              value={startDate}
              hint="Leave blank to take the dates from this term's schedules."
              onChange={(event) => {
                setStartDate(event.target.value);
              }}
            />
            <Input
              label="Ends (optional)"
              type="date"
              value={endDate}
              onChange={(event) => {
                setEndDate(event.target.value);
              }}
            />
          </div>

          <Button
            isLoading={isSaving}
            disabled={name.trim() === '' || yearId === ''}
            onClick={() => {
              void create();
            }}
          >
            Create term
          </Button>
        </div>
      ) : null}

      {terms.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No terms yet. A term holds the schedules a report card is built from, so
          this is the first thing to set up.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {terms.map((term, index) => (
            <li key={term.id} className="py-3">
              {editingId === term.id ? (
                <div className="space-y-3 rounded-lg border border-line bg-surface-sunken p-4">
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <Input
                      label="Term name"
                      value={draft.name}
                      maxLength={TERM_NAME_MAX}
                      onChange={(event) => {
                        setDraft((current) => ({ ...current, name: event.target.value }));
                      }}
                    />
                    <Input
                      label="Starts"
                      type="date"
                      value={draft.startDate}
                      onChange={(event) => {
                        setDraft((current) => ({
                          ...current,
                          startDate: event.target.value,
                        }));
                      }}
                    />
                    <Input
                      label="Ends"
                      type="date"
                      value={draft.endDate}
                      onChange={(event) => {
                        setDraft((current) => ({
                          ...current,
                          endDate: event.target.value,
                        }));
                      }}
                    />
                    <Select
                      label="Grading scheme"
                      options={gradingSchemes.map((scheme) => ({
                        value: scheme.id,
                        label: scheme.name,
                      }))}
                      value={draft.gradingSchemeId}
                      placeholder="Use the school default"
                      onChange={(event) => {
                        setDraft((current) => ({
                          ...current,
                          gradingSchemeId: event.target.value,
                        }));
                      }}
                    />
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      isLoading={busyId === term.id}
                      onClick={() => {
                        void patch(term.id, {
                          name: draft.name,
                          startDate: draft.startDate === '' ? null : draft.startDate,
                          endDate: draft.endDate === '' ? null : draft.endDate,
                          gradingSchemeId:
                            draft.gradingSchemeId === '' ? null : draft.gradingSchemeId,
                        });
                      }}
                    >
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setEditingId(null);
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">
                      <Link
                        href={`/dashboard/exams/terms/${term.id}`}
                        className="hover:underline"
                      >
                        {term.name}
                      </Link>{' '}
                      <span className="text-sm font-normal text-ink-muted">
                        · {term.academicYearName}
                      </span>
                    </p>
                    <p className="text-xs text-ink-muted">
                      {term.windowStart} to {term.windowEnd}
                      {term.startDate === null ? ' (from its schedules)' : ''} ·{' '}
                      {term.scheduleCount} schedule{term.scheduleCount === 1 ? '' : 's'} ·{' '}
                      {term.examCount} exam{term.examCount === 1 ? '' : 's'}
                    </p>
                  </div>

                  <div className="flex flex-nowrap items-center gap-2 whitespace-nowrap">
                    {term.isPublished ? (
                      <Badge variant="success">Report cards published</Badge>
                    ) : (
                      <Badge variant="neutral">Not published</Badge>
                    )}

                    {canWrite ? (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Move ${term.name} up`}
                          disabled={index === 0 || busyId === term.id}
                          onClick={() => {
                            void move(term.id, -1);
                          }}
                        >
                          ↑
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Move ${term.name} down`}
                          disabled={index === terms.length - 1 || busyId === term.id}
                          onClick={() => {
                            void move(term.id, 1);
                          }}
                        >
                          ↓
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setEditingId(term.id);
                            setDraft({
                              name: term.name,
                              startDate: term.startDate ?? '',
                              endDate: term.endDate ?? '',
                              gradingSchemeId: term.gradingSchemeId ?? '',
                            });
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          isLoading={busyId === term.id}
                          onClick={() => {
                            void archive(term);
                          }}
                        >
                          Archive
                        </Button>
                      </>
                    ) : null}

                    {canPublish ? (
                      <Button
                        size="sm"
                        variant={term.isPublished ? 'secondary' : 'primary'}
                        isLoading={busyId === term.id}
                        onClick={() => {
                          void patch(term.id, { isPublished: !term.isPublished });
                        }}
                      >
                        {term.isPublished ? 'Unpublish' : 'Publish report cards'}
                      </Button>
                    ) : null}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
