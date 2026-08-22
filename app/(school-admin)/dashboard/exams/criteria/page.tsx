import type { Metadata } from 'next';
import Link from 'next/link';

import { PromotionCriteriaEditor } from '@/components/exams/PromotionCriteriaEditor';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { listAcademicYearOptions } from '@/lib/academics-queries';
import {
  listGradeCriteria,
  listGradingSchemes,
  listResultSubcategories,
} from '@/lib/exam-queries';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Promotion criteria',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface PageProps {
  searchParams: Promise<{ academicYearId?: string }>;
}

/**
 * How each class is judged, per year.
 *
 * ── The year comes from the query, and this page is dynamic anyway ───────
 * CLAUDE.md's rule is about not making a *prerendered* page dynamic. This one
 * reads the school's grades, criteria and descriptors on every request and
 * could never have been prerendered; the query parameter costs nothing here,
 * and reading the year on the client would mean a second round trip and a
 * second loading state for a value the first render already needs.
 *
 * Defaults to the active year, which is the one a school is setting up in
 * every case but the one where it is preparing next September's.
 */
export default async function PromotionCriteriaPage({ searchParams }: PageProps) {
  const { locationId, permissions } = await requireSchoolPermission('exams.read');
  const { academicYearId } = await searchParams;

  const years = await listAcademicYearOptions(locationId);
  const chosen =
    years.find((year) => year.id === academicYearId) ??
    years.find((year) => year.isActive) ??
    years[0];

  if (chosen === undefined) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Promotion criteria"
          description="How each class is judged at the end of a term."
        />
        <Card>
          <h3 className="text-base font-semibold text-ink">No academic year</h3>
          <p className="mt-1 text-sm text-ink-muted">
            Criteria are set per year, so there is nothing to configure until
            one exists.
          </p>
          <Link
            href="/dashboard/admissions/academic-years"
            className="mt-4 inline-block text-sm font-medium text-brand-primary hover:underline"
          >
            Set up an academic year
          </Link>
        </Card>
      </div>
    );
  }

  const [criteria, subcategories, schemes] = await Promise.all([
    listGradeCriteria(locationId, chosen.id),
    listResultSubcategories(locationId),
    listGradingSchemes(locationId),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Promotion criteria"
        description="Which mechanism each class is judged by, and what it takes to move up."
        actions={
          <Link
            href="/dashboard/exams"
            className="text-sm font-medium text-brand-primary hover:underline"
          >
            Back to exams
          </Link>
        }
      />

      <PromotionCriteriaEditor
        academicYearId={chosen.id}
        academicYears={years}
        criteria={criteria}
        subcategories={subcategories}
        gradingSchemes={schemes.filter((scheme) => scheme.isActive)}
        canWrite={permissions.includes('exams.write')}
      />
    </div>
  );
}
