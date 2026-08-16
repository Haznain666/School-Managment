import type { Metadata } from 'next';
import Link from 'next/link';

import { ReportCardDocument } from '@/components/exams/ReportCardDocument';
import { PrintNow } from '@/components/print/PrintNow';
import { PrintSheet } from '@/components/print/PrintSheet';
import { Card, CardTitle } from '@/components/ui/Card';
import { listChildrenForGuardian, getActiveAcademicYear } from '@/lib/admissions-queries';
import { getStudentReportCard } from '@/lib/portal-results';
import { requireSchoolRole } from '@/lib/school-guard';
import { getSchoolBranding } from '@/lib/school-tenant';
import { getSchoolUserByUid } from '@/lib/school-queries';
import { isUuid } from '@/lib/validation';

export const metadata: Metadata = {
  title: 'Print report card',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * A parent printing their own child's report card.
 *
 * ── The same sheet the school prints ─────────────────────────────────────
 * `ReportCardDocument` inside `PrintSheet`, exactly as
 * `/dashboard/exams/report-cards/print` does. A parent's copy that differed
 * from the school's copy would be discovered at a counter, with the parent
 * holding the wrong one.
 *
 * ── Authorisation is re-derived here, not carried in the URL ─────────────
 * `?child=` is checked against the children this signed-in parent is actually
 * recorded against, and the card comes from `getStudentReportCard`, which
 * refuses an unpublished term. A hand-edited id therefore reaches nothing. This
 * page is a second entry point, so it repeats the whole check rather than
 * trusting that the page which linked here did it.
 */
export default async function ParentReportCardPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ child?: string; term?: string }>;
}) {
  const { claims, locationId } = await requireSchoolRole(['parent']);
  const { child, term } = await searchParams;

  if (!isUuid(child) || !isUuid(term)) {
    return <Message title="Nothing chosen">Choose a term on the Results page.</Message>;
  }

  const profile = await getSchoolUserByUid(locationId, claims.uid);
  const activeYear = await getActiveAcademicYear(locationId);
  const children =
    profile === null
      ? []
      : await listChildrenForGuardian(locationId, profile.id, activeYear?.id ?? null);

  if (!children.some((entry) => entry.studentProfileId === child)) {
    return (
      <Message title="Not available">
        That report card is not one of your children&rsquo;s.
      </Message>
    );
  }

  const [branding, card] = await Promise.all([
    getSchoolBranding(locationId),
    getStudentReportCard(locationId, term, child),
  ]);

  if (card === null) {
    return (
      <Message title="Nothing to print">
        No published report card exists for that term.
      </Message>
    );
  }

  return (
    <>
      <Card className="print:hidden">
        <CardTitle
          title="Ready to print"
          description={`${card.student.studentName} — ${card.termName}, one sheet.`}
        />
        <p className="mt-2 text-sm text-ink-muted">
          In the print dialog choose <strong>A4</strong> and enable{' '}
          <strong>Background graphics</strong> — without it the table rules do
          not appear on the page.
        </p>
        <PrintNow className="mt-4" />
      </Card>

      <PrintSheet paper="a4">
        <ReportCardDocument
          card={card}
          schoolName={branding?.name ?? 'School'}
          logoUrl={branding?.logoUrl ?? null}
        />
      </PrintSheet>
    </>
  );
}

function Message({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="print:hidden">
      <CardTitle title={title} />
      <p className="mt-2 text-sm text-ink-muted">{children}</p>
      <Link
        href="/parent/results"
        className="mt-3 inline-block text-sm font-medium text-brand-primary hover:underline"
      >
        Back to results
      </Link>
    </Card>
  );
}
