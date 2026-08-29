import type { Metadata } from 'next';

import { AcademicYearForm } from '@/components/admissions/AcademicYearForm';
import { PageHeader } from '@/components/ui/PageHeader';
import { getMarkedActiveAcademicYear } from '@/lib/admissions-queries';
import { resolveBranchScope } from '@/lib/branch-scope';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'New academic years',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Creating the school's calendar.
 *
 * `getMarkedActiveAcademicYear` rather than `getActiveAcademicYear`, and the
 * difference decides what the checkbox defaults to. From Sprint 19b the second
 * one falls back to whichever session contains today — so a school that has
 * never pressed *Set as active* still has a working year everywhere — and using
 * it here would leave the box unticked on exactly the school that most needs it
 * ticked. The question this page asks is "has anybody actually chosen one".
 */
export default async function NewAcademicYearPage() {
  const { claims, locationId } = await requireSchoolPermission('admissions.write');

  const [activeYear, scope] = await Promise.all([
    getMarkedActiveAcademicYear(locationId),
    resolveBranchScope(locationId, claims),
  ]);

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="New academic years"
        description="Pakistani schools do not share a calendar, so set the months your own session actually runs between — then say how many years of it to create at once. The names are derived from the years."
      />

      {/*
        Item 13: the campus question is not asked when there is one answer.
        `options` is empty for a one-campus school and for a branch-bound reader
        who reaches only their own, and the server files the run against
        whatever their scope resolves to.
      */}
      <AcademicYearForm hasActiveYear={activeYear !== null} campuses={scope.options} />
    </div>
  );
}
