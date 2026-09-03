import type { Metadata } from 'next';

import { ReportCardPicker } from '@/components/exams/ReportCardPicker';
import { Card } from '@/components/ui/Card';
import { listAdmissionsBranches, listGrades, listSections } from '@/lib/admissions-queries';
import { gradeLabels, sectionLabel } from '@/lib/class-labels';
import { listExamTerms } from '@/lib/exam-queries';
import { narrowByGrade, visibleScopeFor } from '@/lib/principal-visibility';
import { requireSchoolPermission } from '@/lib/school-guard';
import { PrincipalScopeNote } from '@/components/school/PrincipalScopeNote';
import { PageHeader } from '@/components/ui/PageHeader';

export const metadata: Metadata = {
  title: 'Report cards',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function ReportCardsPage() {
  const { claims, locationId } = await requireSchoolPermission('exams.read');

  const [terms, allSections, grades, branches, visible] = await Promise.all([
    listExamTerms(locationId),
    listSections(locationId, {}),
    listGrades(locationId),
    listAdmissionsBranches(locationId),
    // BR4 — Sprint 23, item 3. A head prints report cards for their own
    // classes; the picker offers nobody else's.
    visibleScopeFor({ locationId, role: claims.role, uid: claims.uid }),
  ]);

  const sections = narrowByGrade(visible, allSections);

  // Qualified by campus only where two grades share a name — see
  // `lib/class-labels.ts` for why that rule lives in one place now.
  const gradeById = gradeLabels(grades, branches);

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Exams', href: '/dashboard/exams' }, { label: 'Report cards' }]}
        title="Report cards"
        description="A term of published results for one section, one card per child."
      />

      <PrincipalScopeNote note={visible.note} />

      {terms.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-muted">
            No exam terms yet. A report card is issued for a term, so there is
            nothing to print until one exists.
          </p>
        </Card>
      ) : (
        <ReportCardPicker
          terms={terms}
          sections={sections.map((section) => ({
            id: section.id,
            academicYearId: section.academicYearId,
            label: sectionLabel(
              gradeById.get(section.gradeId) ?? 'Class',
              section.name,
            ),
          }))}
        />
      )}
    </div>
  );
}
