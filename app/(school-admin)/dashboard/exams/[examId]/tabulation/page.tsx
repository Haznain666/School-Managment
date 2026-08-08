import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { TabulationDocument } from '@/components/exams/TabulationDocument';
import { PrintNow } from '@/components/print/PrintNow';
import { PrintSheet } from '@/components/print/PrintSheet';
import { Card, CardTitle } from '@/components/ui/Card';
import { MAX_TABULATION_STUDENTS } from '@/lib/exam-print';
import { getTabulation } from '@/lib/exam-queries';
import { requireSchoolPermission } from '@/lib/school-guard';
import { getSchoolBranding } from '@/lib/school-tenant';
import { isUuid } from '@/lib/validation';

export const metadata: Metadata = {
  title: 'Tabulation sheet',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The tabulation sheet, on screen and on paper.
 *
 * ── The cap ──────────────────────────────────────────────────────────────
 * `MAX_TABULATION_STUDENTS` lives in `lib/exam-print.ts`, alongside the other
 * two, for the reason `lib/challan-print.ts` gives: a number enforced in more
 * than one place has to be declared once. The failure here differs from the
 * challan one — a sheet this wide and this long is unreadable rather than a
 * failed print job — but the answer is the same, and it is better to say
 * "split the class" than to hand someone paper they cannot follow.
 *
 * A section over the cap is a data problem worth seeing, so the message names
 * the number rather than silently truncating the grid.
 */
export default async function TabulationPage({
  params,
}: {
  params: Promise<{ examId: string }>;
}) {
  const { locationId } = await requireSchoolPermission('exams.read');
  const { examId } = await params;

  if (!isUuid(examId)) notFound();

  const [tabulation, branding] = await Promise.all([
    getTabulation(locationId, examId),
    getSchoolBranding(locationId),
  ]);

  if (tabulation === null) notFound();

  if (tabulation.rows.length > MAX_TABULATION_STUDENTS) {
    return (
      <Card>
        <CardTitle title="Too many students for one sheet" />
        <p className="mt-2 text-sm">
          This section holds {tabulation.rows.length} students. A tabulation
          sheet of more than {MAX_TABULATION_STUDENTS} is unreadable on paper
          and unreliable through the browser&apos;s print dialog. Split the
          section, or schedule the exam per section rather than for a combined
          roll.
        </p>
      </Card>
    );
  }

  return (
    <>
      <div className="space-y-4 print:hidden">
        <Link
          href={`/dashboard/exams/${examId}`}
          className="text-sm font-medium text-brand-primary hover:underline"
        >
          ← Back to the exam
        </Link>

        <Card>
          <CardTitle
            title="Tabulation sheet"
            description={`${tabulation.exam.title} · ${tabulation.exam.gradeName} — ${tabulation.exam.sectionName}`}
          />
          <p className="mt-2 text-sm">
            {tabulation.rows.length} student
            {tabulation.rows.length === 1 ? '' : 's'} against{' '}
            {tabulation.papers.length} paper
            {tabulation.papers.length === 1 ? '' : 's'}.
            {tabulation.hasUnpublished
              ? ' Some marks are not published yet and are marked with a dagger — nothing marked that way has reached a parent.'
              : ''}
          </p>
          <p className="mt-2 text-sm text-muted">
            In the print dialog choose <strong>A4 landscape</strong> and enable{' '}
            <strong>Background graphics</strong>, or the table rules do not
            appear on the page.
          </p>
          <PrintNow className="mt-4" />
        </Card>
      </div>

      <PrintSheet paper="a4-landscape">
        <TabulationDocument
          tabulation={tabulation}
          schoolName={branding?.name ?? 'School'}
          logoUrl={branding?.logoUrl ?? null}
        />
      </PrintSheet>
    </>
  );
}
