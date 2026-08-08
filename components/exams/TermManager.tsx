'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * Exam terms — the unit a report card is issued for.
 *
 * Publishing a term is the one control on this screen that a parent can see
 * the effect of, so it is a separate, confirmed action rather than a toggle in
 * a row of fields: pressing it issues every report card for that term at once.
 */

export interface TermRow {
  id: string;
  name: string;
  academicYearId: string;
  academicYearName: string;
  startDate: string;
  endDate: string;
  gradingSchemeId: string | null;
  isPublished: boolean;
  examCount: number;
}

export interface TermManagerProps {
  terms: readonly TermRow[];
  academicYears: readonly { id: string; name: string; isActive: boolean }[];
  gradingSchemes: readonly { id: string; name: string }[];
  canWrite: boolean;
  canPublish: boolean;
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

  const create = async (): Promise<void> => {
    setIsSaving(true);
    setError(null);

    try {
      await schoolFetch('/api/school/exam-terms', {
        method: 'POST',
        body: JSON.stringify({
          name,
          academicYearId: yearId,
          startDate,
          endDate,
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

  const setPublished = async (termId: string, isPublished: boolean): Promise<void> => {
    setBusyId(termId);
    setError(null);

    try {
      await schoolFetch(`/api/school/exam-terms/${termId}`, {
        method: 'PATCH',
        body: JSON.stringify({ isPublished }),
      });
      router.refresh();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'The term could not be updated.'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card
      header={
        <CardTitle
          title="Exam terms"
          description="A term is what a report card is issued for."
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
        <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {isOpen ? (
        <div className="mb-5 space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <Input
              label="Term name"
              value={name}
              placeholder="First Term"
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
            <Select
              label="Academic year"
              options={academicYears.map((year) => ({ value: year.id, label: year.name }))}
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
              label="Starts"
              type="date"
              value={startDate}
              onChange={(event) => {
                setStartDate(event.target.value);
              }}
            />
            <Input
              label="Ends"
              type="date"
              value={endDate}
              onChange={(event) => {
                setEndDate(event.target.value);
              }}
            />
          </div>

          <Button
            isLoading={isSaving}
            onClick={() => {
              void create();
            }}
          >
            Create term
          </Button>
        </div>
      ) : null}

      {terms.length === 0 ? (
        <p className="text-sm text-slate-600">
          No terms yet. A term holds the exams a report card is built from, so
          this is the first thing to set up.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {terms.map((term) => (
            <li
              key={term.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3"
            >
              <div className="min-w-0">
                <p className="font-medium text-slate-900">
                  {term.name}{' '}
                  <span className="text-sm font-normal text-slate-500">
                    · {term.academicYearName}
                  </span>
                </p>
                <p className="text-xs text-slate-500">
                  {term.startDate} to {term.endDate} · {term.examCount} exam
                  {term.examCount === 1 ? '' : 's'}
                </p>
              </div>

              <div className="flex flex-nowrap items-center gap-2 whitespace-nowrap">
                {term.isPublished ? (
                  <Badge variant="success">Report cards published</Badge>
                ) : (
                  <Badge variant="neutral">Not published</Badge>
                )}

                {canPublish ? (
                  <Button
                    size="sm"
                    variant={term.isPublished ? 'secondary' : 'primary'}
                    isLoading={busyId === term.id}
                    onClick={() => {
                      void setPublished(term.id, !term.isPublished);
                    }}
                  >
                    {term.isPublished ? 'Unpublish' : 'Publish report cards'}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
