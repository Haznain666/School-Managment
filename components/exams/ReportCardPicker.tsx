'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import { Card, CardTitle } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { MAX_PRINTABLE_REPORT_CARDS, reportCardPrintHref } from '@/lib/exam-print';

/**
 * Choosing whose report cards to print.
 *
 * A section at a time, deliberately. A whole-school button would be one click
 * from a job of eight hundred cards, which is both past
 * `MAX_PRINTABLE_REPORT_CARDS` and past what any browser print dialog survives
 * — and a school hands report cards out class by class anyway.
 *
 * The link opens in a new tab so this screen, and the choice made on it, are
 * still here afterwards.
 */

export interface ReportCardPickerProps {
  terms: readonly { id: string; name: string; academicYearId: string; academicYearName: string; isPublished: boolean }[];
  sections: readonly { id: string; academicYearId: string; label: string }[];
}

export function ReportCardPicker({ terms, sections }: ReportCardPickerProps) {
  const [termId, setTermId] = useState('');
  const [sectionId, setSectionId] = useState('');

  const term = terms.find((candidate) => candidate.id === termId);

  const sectionOptions = useMemo(() => {
    if (term === undefined) return [];
    return sections
      .filter((section) => section.academicYearId === term.academicYearId)
      .map((section) => ({ value: section.id, label: section.label }));
  }, [term, sections]);

  return (
    <Card
      header={
        <CardTitle
          title="Print report cards"
          description="One section at a time — that is how a school hands them out."
        />
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Select
          label="Term"
          options={terms.map((row) => ({
            value: row.id,
            label: `${row.name} · ${row.academicYearName}`,
          }))}
          value={termId}
          placeholder="Select a term"
          onChange={(event) => {
            setTermId(event.target.value);
            setSectionId('');
          }}
        />
        <Select
          label="Section"
          options={sectionOptions}
          value={sectionId}
          placeholder={termId === '' ? 'Choose a term first' : 'Select a section'}
          disabled={sectionOptions.length === 0}
          onChange={(event) => {
            setSectionId(event.target.value);
          }}
        />

        <div className="flex items-end">
          {termId === '' || sectionId === '' ? (
            <p className="text-sm text-ink-muted">
              Choose a term and a section to build the print job.
            </p>
          ) : (
            <Link
              href={reportCardPrintHref(termId, sectionId)}
              target="_blank"
              rel="noopener"
              className="inline-flex h-10 items-center justify-center rounded-lg bg-brand-primary px-4 text-sm font-medium text-brand-onPrimary hover:opacity-90"
            >
              Open report cards
            </Link>
          )}
        </div>
      </div>

      {term !== undefined && !term.isPublished ? (
        <p className="mt-4 rounded-lg bg-status-warning-subtle px-3 py-2 text-sm text-status-warning-onSubtle">
          {term.name} is not published yet. The cards will print, marked
          &ldquo;preview&rdquo; — publish the term when the checking is done.
        </p>
      ) : null}

      <p className="mt-4 text-xs text-ink-muted">
        At most {MAX_PRINTABLE_REPORT_CARDS} cards in one job. Larger jobs tend
        to fail part-way through the browser&apos;s print dialog, and a
        half-printed stack is discovered while parents are queuing.
      </p>
    </Card>
  );
}
