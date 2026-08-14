import type { Metadata } from 'next';

import { AttendanceMarker } from '@/components/academics/AttendanceMarker';
import { PageHeader } from '@/components/ui/PageHeader';
import { listAcademicYearOptions } from '@/lib/academics-queries';
import { listGrades, listSections } from '@/lib/admissions-queries';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Mark attendance',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function MarkAttendancePage() {
  const { claims, locationId } = await requireSchoolPermission('attendance.mark');

  const [academicYears, grades, sections] = await Promise.all([
    listAcademicYearOptions(locationId),
    // A branch-scoped admin only ever sees their own branch's grades.
    listGrades(locationId, claims.branchId ?? undefined),
    listSections(locationId, {}),
  ]);

  const gradeIds = new Set(grades.map((grade) => grade.id));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mark attendance"
        description="Attendance is daily, not per period — that is what boards report and what a parent asks about."
      />

      <AttendanceMarker
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
