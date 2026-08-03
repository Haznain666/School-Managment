import type { Metadata } from 'next';

import { AttendanceReports } from '@/components/academics/AttendanceReports';
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
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Attendance reports</h2>
        <p className="mt-1 text-sm text-slate-500">
          A month at a time, per student, with the class average. Below 75% is
          where most schools intervene.
        </p>
      </div>

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
