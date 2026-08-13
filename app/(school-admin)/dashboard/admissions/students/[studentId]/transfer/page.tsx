import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { TransferPanel } from '@/components/admissions/TransferPanel';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import {
  getStudentDetail,
  listAdmissionsBranches,
  listGrades,
  listSections,
} from '@/lib/admissions-queries';
import { requireSchoolPermission } from '@/lib/school-guard';
import { isUuid } from '@/lib/validation';

export const metadata: Metadata = {
  title: 'Transfer student',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Campus transfer for one student.
 *
 * Reached from the student's profile rather than from a list, because a
 * transfer is always about one named child and always starts from looking at
 * them. There is deliberately no bulk transfer: moving a class between
 * campuses is a merger, not a workflow, and doing it a student at a time is
 * the right amount of friction for something that reassigns fees.
 */
export default async function TransferStudentPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const { studentId } = await params;
  if (!isUuid(studentId)) notFound();

  const { locationId } = await requireSchoolPermission('students.transfer');

  const student = await getStudentDetail(locationId, studentId);
  if (student === null) notFound();

  // Every grade in the school, not just the caller's branch: a transfer's whole
  // purpose is to cross campuses. `students.transfer` is school_admin-only by
  // default for that reason, and the route checks both ends regardless.
  const grades = await listGrades(locationId);

  const sectionLists = await Promise.all(
    grades.map(async (grade) => ({
      grade,
      sections: await listSections(locationId, { gradeId: grade.id }),
    })),
  );

  const branches = await listAdmissionsBranches(locationId);
  const campusName = new Map(branches.map((branch) => [branch.id, branch.name]));

  // The campus is named on every option, not only when it disambiguates. This
  // screen exists to move a child between campuses; which one they are going
  // to is the decision being made, not a detail.
  const sections = sectionLists.flatMap(({ grade, sections: rows }) =>
    rows
      .filter((section) => section.isActive)
      .map((section) => ({
        id: section.id,
        branchId: grade.branchId,
        academicYearId: section.academicYearId,
        label: `${campusName.get(grade.branchId) ?? 'Campus'} — ${grade.label} ${section.name} (${section.studentCount})`,
      })),
  );

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        breadcrumbs={[
          { label: 'All Students', href: '/dashboard/admissions/students' },
          { label: student.name, href: `/dashboard/admissions/students/${studentId}` },
          { label: 'Transfer' },
        ]}
        title={`Transfer ${student.name}`}
        description="Moving a student between campuses closes their enrolment at one and opens it at the other, and splits the month’s fees on the date they move."
      />

      {sections.length < 2 ? (
        <Card>
          <p className="text-sm text-ink">
            This school has classes at only one campus, so there is nowhere to
            transfer to.
          </p>
        </Card>
      ) : (
        <TransferPanel
          studentProfileId={studentId}
          studentName={student.name}
          sections={sections}
        />
      )}
    </div>
  );
}
