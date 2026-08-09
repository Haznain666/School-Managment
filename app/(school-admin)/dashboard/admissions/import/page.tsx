import type { Metadata } from 'next';
import Link from 'next/link';

import { StudentImporter } from '@/components/admissions/StudentImporter';
import { Card } from '@/components/ui/Card';
import {
  getActiveAcademicYear,
  listGrades,
  listSections,
} from '@/lib/admissions-queries';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Import students',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Bulk student import.
 *
 * The class list is resolved here rather than fetched by the component: the
 * importer needs it before the operator has uploaded anything, and a
 * branch-scoped admin must only ever see their own campus's classes — which is
 * a decision for the server, not a filter for the browser.
 */
export default async function ImportStudentsPage() {
  const { claims, locationId } = await requireSchoolPermission('students.import');

  const activeYear = await getActiveAcademicYear(locationId);

  if (activeYear === null) {
    return (
      <div className="max-w-3xl space-y-4">
        <h2 className="text-xl font-semibold text-slate-900">Import students</h2>
        <Card>
          <p className="text-sm text-slate-700">
            This school has no active academic year, so there is nowhere for
            imported students to be enrolled.
          </p>
          <p className="mt-3 text-sm text-slate-600">
            <Link
              href="/dashboard/admissions/academic-years"
              className="font-medium text-brand-primary hover:underline"
            >
              Set an academic year
            </Link>{' '}
            first, then set up the grades and sections these students join.
          </p>
        </Card>
      </div>
    );
  }

  const grades = await listGrades(locationId, claims.branchId ?? undefined);

  const sectionLists = await Promise.all(
    grades.map(async (grade) => ({
      grade,
      sections: await listSections(locationId, {
        gradeId: grade.id,
        academicYearId: activeYear.id,
      }),
    })),
  );

  // "Grade 6 — A (28 students)". The count is there because loading forty
  // children into a section that already has thirty is a mistake somebody
  // makes once, and the only moment to catch it is while choosing.
  const options = sectionLists.flatMap(({ grade, sections }) =>
    sections
      .filter((section) => section.isActive)
      .map((section) => ({
        id: section.id,
        label: `${grade.label} — ${section.name} (${section.studentCount} student${section.studentCount === 1 ? '' : 's'})`,
      })),
  );

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Import students</h2>
        <p className="mt-1 text-sm text-slate-500">
          Load a class from a spreadsheet. Nothing is saved until you have seen
          exactly what will happen — {activeYear.name}.
        </p>
      </div>

      {options.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-700">
            There are no classes to import into yet.
          </p>
          <p className="mt-3 text-sm text-slate-600">
            <Link
              href="/dashboard/admissions/grades"
              className="font-medium text-brand-primary hover:underline"
            >
              Set up grades and sections
            </Link>{' '}
            for {activeYear.name}, then come back.
          </p>
        </Card>
      ) : (
        <StudentImporter sections={options} />
      )}
    </div>
  );
}
