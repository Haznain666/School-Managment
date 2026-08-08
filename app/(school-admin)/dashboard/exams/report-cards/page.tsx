import type { Metadata } from 'next';
import Link from 'next/link';

import { ReportCardPicker } from '@/components/exams/ReportCardPicker';
import { Card } from '@/components/ui/Card';
import { listGrades, listSections } from '@/lib/admissions-queries';
import { listExamTerms } from '@/lib/exam-queries';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Report cards',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function ReportCardsPage() {
  const { locationId } = await requireSchoolPermission('exams.read');

  const [terms, sections, grades] = await Promise.all([
    listExamTerms(locationId),
    listSections(locationId, {}),
    listGrades(locationId),
  ]);

  const gradeById = new Map(grades.map((grade) => [grade.id, grade.label]));

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/dashboard/exams"
          className="text-sm font-medium text-brand-primary hover:underline"
        >
          ← Exams
        </Link>
        <h2 className="mt-1 text-xl font-semibold text-slate-900">Report cards</h2>
        <p className="mt-1 text-sm text-slate-500">
          A term of published results for one section, one card per child.
        </p>
      </div>

      {terms.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-600">
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
            label: `${gradeById.get(section.gradeId) ?? 'Class'} — ${section.name}`,
          }))}
        />
      )}
    </div>
  );
}
