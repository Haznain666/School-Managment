import type { Metadata } from 'next';
import Link from 'next/link';

import { TermManager } from '@/components/exams/TermManager';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { listAcademicYearOptions } from '@/lib/academics-queries';
import { listExamTerms, listGradingSchemes } from '@/lib/exam-queries';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Exam terms',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The terms of the year, in the order the school reads them.
 *
 * Terms moved off the Exams overview onto a screen of their own in Sprint 14,
 * because a term stopped being a name and two dates: it now owns the datesheets
 * beneath it, and the row is a way in rather than a record. Opening one lands
 * on its schedules.
 *
 * Every read is scoped to the caller's own school — the location id comes from
 * their verified session, so there is no request parameter that could widen it.
 */
export default async function ExamTermsPage() {
  const { locationId, permissions } = await requireSchoolPermission('exams.read');

  const [terms, years, schemes] = await Promise.all([
    listExamTerms(locationId),
    listAcademicYearOptions(locationId),
    listGradingSchemes(locationId),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Exam terms"
        description="A term is what a report card is issued for. Its datesheets live inside it."
        actions={
          <Link
            href="/dashboard/exams"
            className="text-sm font-medium text-brand-primary hover:underline"
          >
            Back to exams
          </Link>
        }
      />

      {years.length === 0 ? (
        <Card>
          <h3 className="text-base font-semibold text-ink">No academic year</h3>
          <p className="mt-1 text-sm text-ink-muted">
            A term is filed against a year, so nothing here can be set up until
            one exists.
          </p>
          <Link
            href="/dashboard/admissions/academic-years"
            className="mt-4 inline-block text-sm font-medium text-brand-primary hover:underline"
          >
            Set up an academic year
          </Link>
        </Card>
      ) : null}

      <TermManager
        terms={terms}
        academicYears={years}
        gradingSchemes={schemes.filter((scheme) => scheme.isActive)}
        canWrite={permissions.includes('exams.write')}
        canPublish={permissions.includes('exams.publish')}
      />
    </div>
  );
}
