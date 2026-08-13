import type { Metadata } from 'next';

import { AttendanceReports } from '@/components/academics/AttendanceReports';
import { PageHeader } from '@/components/ui/PageHeader';
import { listAcademicYearOptions } from '@/lib/academics-queries';
import { listGrades, listSections } from '@/lib/admissions-queries';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Attendance reports',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function AttendanceReportsPage() {
  const { claims, locationId } = await requireSchoolPermission('academics.read');

  const [academicYears, grades, sections] = await Promise.all([
    listAcademicYearOptions(locationId),
    listGrades(locationId, claims.branchId ?? undefined),
    listSections(locationId, {}),
  ]);

  const gradeIds = new Set(grades.map((grade) => grade.id));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance reports"
        description="A month at a time, per student, with the class average. Below 75% is where most schools intervene."
      />

      <AttendanceReports
        academicYears={academicYears}
        grades={grades.map((grade) => ({ id: grade.id, label: grade.label }))}
        sections={sections
          .filter((section) => gradeIds.has(section.gradeId))
          .map((section) => ({
            id: section.id,
            gradeId: section.gradeId,
            academicYearId: section.academicYearId,
            name: section.name,
          }))}
      />
    </div>
  );
}
