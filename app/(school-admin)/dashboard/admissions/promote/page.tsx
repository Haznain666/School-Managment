import type { Metadata } from 'next';
import Link from 'next/link';

import { PromotionRunner } from '@/components/admissions/PromotionRunner';
import { Card } from '@/components/ui/Card';
import {
  getActiveAcademicYear,
  listAcademicYears,
  listAdmissionsBranches,
  listGrades,
  listSections,
} from '@/lib/admissions-queries';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Promote students',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Academic-year rollover.
 *
 * Grades, years and every section are resolved here because the review screen
 * needs all three before the operator has chosen anything, and because a
 * branch-scoped admin must only ever see their own campus — a decision for the
 * server, not a filter for the browser.
 */
export default async function PromoteStudentsPage() {
  const { claims, locationId } = await requireSchoolPermission('students.promote');

  const [years, activeYear, grades, branches] = await Promise.all([
    listAcademicYears(locationId),
    getActiveAcademicYear(locationId),
    listGrades(locationId, claims.branchId ?? undefined),
    listAdmissionsBranches(locationId),
  ]);

  if (years.length < 2) {
    return (
      <div className="max-w-3xl space-y-4">
        <h2 className="text-xl font-semibold text-slate-900">Promote students</h2>
        <Card>
          <p className="text-sm text-slate-700">
            A promotion moves students from one academic year into another, and
            this school has {years.length === 0 ? 'none' : 'only one'}.
          </p>
          <p className="mt-3 text-sm text-slate-600">
            <Link
              href="/dashboard/admissions/academic-years"
              className="font-medium text-brand-primary hover:underline"
            >
              Add next year
            </Link>{' '}
            and set up its grades and sections first.
          </p>
        </Card>
      </div>
    );
  }

  // Every section of every grade the caller can see. The receiving year is not
  // known until they choose it, so the list cannot be narrowed here; the
  // component filters out the grade being promoted *from*, which is the only
  // destination that is always wrong.
  const sectionLists = await Promise.all(
    grades.map(async (grade) => ({
      grade,
      sections: await listSections(locationId, { gradeId: grade.id }),
    })),
  );

  /**
   * Disambiguates a grade name that exists at more than one campus.
   *
   * A school running "Grade 5" at two branches otherwise gets a picker reading
   * "Grade 4, Grade 5, Grade 6, Grade 5", and promoting into the wrong campus
   * is not a mistake anyone would notice until the register came out. The
   * campus is added only when it is needed, so a single-campus school is not
   * made to read its own name against every class.
   */
  function gradeLabel(grade: (typeof grades)[number]): string {
    const duplicated = grades.filter((other) => other.label === grade.label).length > 1;
    if (!duplicated) return grade.label;

    const campus = branches.find((branch) => branch.id === grade.branchId);
    return campus === undefined ? grade.label : `${grade.label} (${campus.name})`;
  }

  const sections = sectionLists.flatMap(({ grade, sections: rows }) =>
    rows
      .filter((section) => section.isActive)
      .map((section) => ({
        id: section.id,
        gradeId: grade.id,
        academicYearId: section.academicYearId,
        label: `${gradeLabel(grade)} — ${section.name} (${section.studentCount})`,
      })),
  );

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Promote students</h2>
        <p className="mt-1 text-sm text-slate-500">
          Move a class into the next academic year. Every student is listed for
          review first, and last year&rsquo;s records are never edited.
        </p>
      </div>

      <PromotionRunner
        grades={grades.map((grade) => ({ id: grade.id, label: gradeLabel(grade) }))}
        years={years.map((year) => ({
          id: year.id,
          name: year.name,
          // Ordered on the pair, not the year: a June start would otherwise
          // sort ahead of the previous September's.
          startsAt: year.startYear * 12 + year.startMonth,
        }))}
        activeYearId={activeYear?.id ?? null}
        sections={sections}
      />
    </div>
  );
}
