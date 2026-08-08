import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AdmitCardDocument } from '@/components/exams/AdmitCardDocument';
import { PrintNow } from '@/components/print/PrintNow';
import { PrintSheet } from '@/components/print/PrintSheet';
import { Card, CardTitle } from '@/components/ui/Card';
import { MAX_PRINTABLE_ADMIT_CARDS } from '@/lib/exam-print';
import { getAdmitCards } from '@/lib/exam-queries';
import { requireSchoolPermission } from '@/lib/school-guard';
import { getSchoolBranding } from '@/lib/school-tenant';
import { isUuid } from '@/lib/validation';

export const metadata: Metadata = {
  title: 'Admit cards',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Admit cards for one exam — one per student on the roll.
 *
 * Refused until the datesheet is announced. A card printed from an
 * unannounced exam would carry dates the school has not committed to, and a
 * student holding one has no way of knowing that. The `exams.publish` step is
 * what makes those dates real; this page will not pre-empt it.
 *
 * Two cards to a sheet: a class of forty is twenty sheets rather than forty.
 */
export default async function AdmitCardsPage({
  params,
}: {
  params: Promise<{ examId: string }>;
}) {
  const { locationId } = await requireSchoolPermission('exams.read');
  const { examId } = await params;

  if (!isUuid(examId)) notFound();

  const [result, branding] = await Promise.all([
    getAdmitCards(locationId, examId),
    getSchoolBranding(locationId),
  ]);

  if (result === null) notFound();

  const { exam, cards } = result;

  if (!exam.isPublished) {
    return (
      <Message examId={examId} title="The datesheet is not announced yet">
        Announce it on the exam page first. Until then these dates are a plan,
        and an admit card is not the place to publish a plan.
      </Message>
    );
  }

  if (cards.length === 0) {
    return (
      <Message examId={examId} title="Nobody to admit">
        No students are actively enrolled in {exam.gradeName} — {exam.sectionName}{' '}
        for this year.
      </Message>
    );
  }

  if (cards.length > MAX_PRINTABLE_ADMIT_CARDS) {
    return (
      <Message examId={examId} title="Too many at once">
        {cards.length} students are on this roll. Print at most{' '}
        {MAX_PRINTABLE_ADMIT_CARDS} cards in one job — larger jobs tend to fail
        part-way through the browser&apos;s print dialog, and a half-printed
        batch is worse than none.
      </Message>
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
            title="Ready to print"
            description={`${cards.length} admit card${cards.length === 1 ? '' : 's'}, two to a sheet.`}
          />
          <p className="mt-2 text-sm text-muted">
            In the print dialog choose <strong>A4</strong> and enable{' '}
            <strong>Background graphics</strong>, or the card borders do not
            appear on the page.
          </p>
          <PrintNow className="mt-4" />
        </Card>
      </div>

      <PrintSheet paper="a4">
        {cards.map((card, index) => (
          <AdmitCardDocument
            key={card.student.studentProfileId}
            card={card}
            schoolName={branding?.name ?? 'School'}
            logoUrl={branding?.logoUrl ?? null}
            // Two to a sheet: break after every second card, never after the
            // last one — a trailing blank page is the classic bulk-print bug.
            breakAfter={index % 2 === 1 && index < cards.length - 1}
          />
        ))}
      </PrintSheet>
    </>
  );
}

function Message({
  examId,
  title,
  children,
}: {
  examId: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardTitle title={title} />
      <p className="mt-2 text-sm">{children}</p>
      <Link
        href={`/dashboard/exams/${examId}`}
        className="mt-4 inline-block text-sm font-medium text-brand-primary hover:underline"
      >
        Back to the exam
      </Link>
    </Card>
  );
}
