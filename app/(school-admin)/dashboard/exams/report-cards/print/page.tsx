import type { Metadata } from 'next';
import Link from 'next/link';

import { ReportCardDocument } from '@/components/exams/ReportCardDocument';
import { PrintNow } from '@/components/print/PrintNow';
import { PrintSheet } from '@/components/print/PrintSheet';
import { Card, CardTitle } from '@/components/ui/Card';
import { MAX_PRINTABLE_REPORT_CARDS } from '@/lib/exam-print';
import { getSectionReportCards } from '@/lib/exam-queries';
import { requireSchoolPermission } from '@/lib/school-guard';
import { getSchoolBranding } from '@/lib/school-tenant';
import { isUuid } from '@/lib/validation';

export const metadata: Metadata = {
  title: 'Print report cards',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Bulk report-card printing.
 *
 * ── Why a whole section, computed together ───────────────────────────────
 * Position in class is a property of the class. Printing one card in isolation
 * would mean computing everyone anyway, or printing a position that came from
 * somewhere else — so the unit of work is the section, and one student is the
 * same job filtered at the end.
 *
 * ── The cap ──────────────────────────────────────────────────────────────
 * `MAX_PRINTABLE_REPORT_CARDS` is in `lib/exam-print.ts` because the picker
 * enforces it client-side too, and the two must not drift — the same reasoning
 * `lib/challan-print.ts` records. Reaching this page over the cap now takes a
 * hand-edited URL; it stays checked here regardless, because the client is not
 * a gate.
 */
export default async function ReportCardPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ termId?: string; sectionId?: string; studentProfileId?: string }>;
}) {
  const { locationId } = await requireSchoolPermission('exams.read');
  const { termId, sectionId, studentProfileId } = await searchParams;

  if (!isUuid(termId) || !isUuid(sectionId)) {
    return (
      <Message title="Nothing chosen">
        Choose a term and a section on the{' '}
        <Link href="/dashboard/exams/report-cards" className="underline">
          report cards page
        </Link>{' '}
        and print from there.
      </Message>
    );
  }

  const [branding, all] = await Promise.all([
    getSchoolBranding(locationId),
    // Tenant-scoped, so a term or section belonging to another school comes
    // back empty rather than leaking.
    getSectionReportCards(locationId, termId, sectionId),
  ]);

  const cards =
    studentProfileId === undefined || !isUuid(studentProfileId)
      ? all
      : all.filter((card) => card.student.studentProfileId === studentProfileId);

  if (cards.length === 0) {
    return (
      <Message title="Nothing to print">
        No actively enrolled students were found for that term and section in
        this school.
      </Message>
    );
  }

  if (cards.length > MAX_PRINTABLE_REPORT_CARDS) {
    return (
      <Message title="Too many at once">
        {cards.length} report cards were selected. Print at most{' '}
        {MAX_PRINTABLE_REPORT_CARDS} in one go — larger jobs tend to fail
        part-way through the browser&apos;s print dialog, and a half-printed
        stack is discovered while parents are queuing.
      </Message>
    );
  }

  const first = cards[0];
  const published = first?.termIsPublished ?? false;

  return (
    <>
      <Card className="print:hidden">
        <CardTitle
          title="Ready to print"
          description={`${cards.length} report card${cards.length === 1 ? '' : 's'}, one per sheet.`}
        />
        {published ? null : (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            This term is not published, so every card is marked{' '}
            <strong>PREVIEW</strong>. Publish the term when the checking is done
            — a card handed out before that has no standing.
          </p>
        )}
        <p className="mt-2 text-sm text-muted">
          In the print dialog choose <strong>A4</strong> and enable{' '}
          <strong>Background graphics</strong> — without it the table rules do
          not appear on the page.
        </p>
        <PrintNow className="mt-4" />
      </Card>

      <PrintSheet paper="a4">
        {cards.map((card, index) => (
          <ReportCardDocument
            key={card.student.studentProfileId}
            card={card}
            schoolName={branding?.name ?? 'School'}
            logoUrl={branding?.logoUrl ?? null}
            breakAfter={index < cards.length - 1}
          />
        ))}
      </PrintSheet>
    </>
  );
}

function Message({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardTitle title={title} />
      <p className="mt-2 text-sm">{children}</p>
    </Card>
  );
}
