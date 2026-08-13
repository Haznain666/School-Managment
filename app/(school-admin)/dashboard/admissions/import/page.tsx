import type { Metadata } from 'next';
import Link from 'next/link';

import { StudentImporter } from '@/components/admissions/StudentImporter';
import { Card } from '@/components/ui/Card';
import {
  getActiveAcademicYear,
  listAdmissionsBranches,
  listGrades,
  listSections,
} from '@/lib/admissions-queries';
import { gradeLabels, sectionLabel } from '@/lib/class-labels';
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
        <h2 className="text-xl font-semibold text-ink">Import students</h2>
        <Card>
          <p className="text-sm text-ink">
            This school has no active academic year, so there is nowhere for
            imported students to be enrolled.
          </p>
          <p className="mt-3 text-sm text-ink-muted">
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

  /*
   * "Grade 6 (Johar Town) — A (28)".
   *
   * The count is there because loading forty children into a section that
   * already has thirty is a mistake somebody makes once, and the only moment to
   * catch it is while choosing. The campus, where it is needed, is there for the
   * same reason: loading a class into the wrong one is discovered when the
   * register comes out. See `lib/class-labels.ts`.
   */
  const classNames = gradeLabels(grades, await listAdmissionsBranches(locationId));

  const options = sectionLists.flatMap(({ grade, sections }) =>
    sections
      .filter((section) => section.isActive)
      .map((section) => ({
        id: section.id,
        label: sectionLabel(
          classNames.get(grade.id) ?? grade.label,
          section.name,
          section.studentCount,
        ),
      })),
  );

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-ink">Import students</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Load a class from a spreadsheet. Nothing is saved until you have seen
          exactly what will happen — {activeYear.name}.
        </p>
      </div>

      {options.length === 0 ? (
        <Card>
          <p className="text-sm text-ink">
            There are no classes to import into yet.
          </p>
          <p className="mt-3 text-sm text-ink-muted">
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
