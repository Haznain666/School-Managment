import type { Metadata } from 'next';
import Link from 'next/link';

import { PromotionRunner } from '@/components/admissions/PromotionRunner';
import { BranchSelector } from '@/components/school/BranchSelector';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import {
  getActiveAcademicYear,
  listAcademicYears,
  listAdmissionsBranches,
  listGrades,
  listSections,
} from '@/lib/admissions-queries';
import { effectiveBranchIds, resolveBranchScope } from '@/lib/branch-scope';
import { gradeLabels, sectionLabel } from '@/lib/class-labels';
import { narrowGrades, visibleScopeFor } from '@/lib/principal-visibility';
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
 * needs all three before the operator has chosen anything, and because who may
 * see which campus is a decision for the server, not a filter for the browser.
 *
 * ── Sprint 19b, item 15a: the campus selector ───────────────────────────
 * Grades were narrowed by `claims.branchId`, which answers for exactly one
 * campus and therefore showed a person granted two of them only their own — and
 * showed the *owner* of a three-campus group all three classes called "Grade 5"
 * with nothing to promote between. `resolveBranchScope` is the rule now, and
 * `?branch=` narrows it further; item 13 hides the control at a school with one
 * campus.
 *
 * ── And item 15c: the destination list carries its campus ───────────────
 * Every section shipped to the client names the campus of the grade it belongs
 * to, so the picker can refuse a cross-campus destination before the operator
 * chooses one. `POST /api/school/promotions/[runId]/apply` re-checks it — this
 * is the courtesy, that is the rule.
 */
export default async function PromoteStudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string | string[] }>;
}) {
  const { claims, locationId } = await requireSchoolPermission('students.promote');

  const requested = (await searchParams).branch;
  const scope = await resolveBranchScope(
    locationId,
    claims,
    Array.isArray(requested) ? requested[0] : requested,
  );

  const [years, activeYear, allGrades, branches, visible] = await Promise.all([
    // Years the chosen campus actually runs, plus every school-wide year —
    // which is all of them until somebody attaches a campus. A group whose
    // Karachi campus runs April–March must not be offered Lahore's sessions.
    listAcademicYears(locationId, effectiveBranchIds(scope)),
    getActiveAcademicYear(locationId),
    listGrades(locationId, undefined, effectiveBranchIds(scope)),
    listAdmissionsBranches(locationId),
    // BR4 — Sprint 23, item 3. Composes with the campus scope above rather
    // than replacing it: a head of the O-Levels at Karachi promotes O-Levels
    // at Karachi.
    visibleScopeFor({ locationId, role: claims.role, uid: claims.uid }),
  ]);

  const grades = narrowGrades(visible, allGrades);

  const selector =
    scope.options.length === 0 ? null : (
      <div className="max-w-xs">
        <BranchSelector
          options={scope.options}
          selected={scope.selected}
          allowsAll={scope.allowsAll}
        />
      </div>
    );

  if (years.length < 2) {
    return (
      <div className="max-w-3xl space-y-4">
        <PageHeader title="Promote students" />
        {selector}
        <Card>
          <p className="text-sm text-ink">
            A promotion moves students from one academic year into another, and
            this school has {years.length === 0 ? 'none' : 'only one'}.
          </p>
          <p className="mt-3 text-sm text-ink-muted">
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
  // destination that is always wrong, and every section at another campus,
  // which is a transfer rather than a promotion.
  const sectionLists = await Promise.all(
    grades.map(async (grade) => ({
      grade,
      sections: await listSections(locationId, { gradeId: grade.id }),
    })),
  );

  // Qualified by campus only where two grades share a name. Promoting into the
  // wrong campus is not a mistake anyone would notice until the register came
  // out. See `lib/class-labels.ts`.
  const labelForGrade = gradeLabels(grades, branches);
  const campusName = new Map(branches.map((branch) => [branch.id, branch.name]));

  const sections = sectionLists.flatMap(({ grade, sections: rows }) =>
    rows
      .filter((section) => section.isActive)
      .map((section) => ({
        id: section.id,
        gradeId: grade.id,
        branchId: grade.branchId,
        academicYearId: section.academicYearId,
        label: sectionLabel(
          labelForGrade.get(grade.id) ?? grade.label,
          section.name,
          section.studentCount,
        ),
      })),
  );

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title="Promote students"
        description="Move a class into the next academic year. Every student is listed for review first, and last year&rsquo;s records are never edited."
      />

      {selector}

      <PromotionRunner
        grades={grades.map((grade) => ({
          id: grade.id,
          label: labelForGrade.get(grade.id) ?? grade.label,
          branchId: grade.branchId,
          branchName: campusName.get(grade.branchId) ?? null,
        }))}
        years={years.map((year) => ({
          id: year.id,
          name: year.name,
          // Ordered on the pair, not the year: a June start would otherwise
          // sort ahead of the previous September's.
          startsAt: year.startYear * 12 + year.startMonth,
        }))}
        activeYearId={activeYear?.id ?? null}
        sections={sections}
        selectedBranchId={scope.selected}
      />
    </div>
  );
}
