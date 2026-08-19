import type { Metadata } from 'next';

import { TimetableWorkspace } from '@/components/academics/TimetableWorkspace';
import { PageHeader } from '@/components/ui/PageHeader';
import {
  listAcademicYearOptions,
  listSubjects,
  listTeacherOptions,
} from '@/lib/academics-queries';
import { listGrades, listSections } from '@/lib/admissions-queries';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Timetable',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The timetable builder's selectors are filled server-side, from the caller's
 * own school. A branch-scoped admin only ever sees their own branch's grades,
 * so the sections they can reach follow from that rather than from anything the
 * browser sends — and, since period schedules are assigned per grade, so are
 * the schedules they can assign.
 *
 * The builder and the schedule editor are wrapped in one client component
 * rather than sitting side by side, because editing a schedule changes the rows
 * of the grid above it. Two independent components would leave the grid showing
 * a period that had just been retired until somebody reloaded.
 */
export default async function TimetablePage() {
  const { claims, locationId, permissions } = await requireSchoolPermission('academics.read');

  const [academicYears, grades, sections, subjects, teachers] = await Promise.all([
    listAcademicYearOptions(locationId),
    listGrades(locationId, claims.branchId ?? undefined),
    listSections(locationId, {}),
    listSubjects(locationId, { activeOnly: true }),
    listTeacherOptions(locationId),
  ]);

  const gradeIds = new Set(grades.map((grade) => grade.id));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Timetable"
        description="Build a section&rsquo;s week. Clashes are only visible when the whole week is on one screen, which is why this is a grid and not a list."
      />

      <TimetableWorkspace
        canEdit={permissions.includes('academics.write')}
        academicYears={academicYears}
        grades={grades.map((grade) => ({
          id: grade.id,
          label: grade.label,
          branchName: grade.branchName ?? null,
        }))}
        sections={sections
          .filter((section) => gradeIds.has(section.gradeId))
          .map((section) => ({
            id: section.id,
            gradeId: section.gradeId,
            academicYearId: section.academicYearId,
            name: section.name,
          }))}
        subjects={subjects.map((subject) => ({
          id: subject.id,
          name: subject.name,
          code: subject.code,
          color: subject.color,
        }))}
        teachers={teachers}
      />
    </div>
  );
}
