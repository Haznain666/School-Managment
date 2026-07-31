import type { Metadata } from 'next';
import Link from 'next/link';

import { GradeSetupGrid } from '@/components/admissions/GradeSetupGrid';
import { Card } from '@/components/ui/Card';
import {
  getActiveAcademicYear,
  listAdmissionsBranches,
} from '@/lib/admissions-queries';
import { requireSchoolRole } from '@/lib/school-guard';
import { ADMIN_PORTAL_ROLES } from '@/types/school-auth';

export const metadata: Metadata = {
  title: 'Grades & sections',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Grade and section setup, one branch at a time.
 *
 * The selected branch lives in the URL rather than in component state, so a
 * school with six campuses can link a colleague straight to the right one.
 */
export default async function GradesPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string }>;
}) {
  const { claims, locationId } = await requireSchoolRole(ADMIN_PORTAL_ROLES);

  const [branches, activeYear] = await Promise.all([
    listAdmissionsBranches(locationId),
    getActiveAcademicYear(locationId),
  ]);

  // A branch-scoped admin only ever sees their own campus.
  const visible =
    claims.branchId === null
      ? branches
      : branches.filter((branch) => branch.id === claims.branchId);

  const { branch: requested } = await searchParams;
  const selected =
    visible.find((branch) => branch.id === requested) ?? visible[0] ?? null;

  const canEdit = claims.role === 'school_admin' || claims.role === 'branch_admin';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Grades &amp; sections</h2>
        <p className="mt-1 text-sm text-slate-500">
          Grades come from the platform’s list for each branch’s curriculum — you
          can rename them for display, but not reorder them. Sections are yours,
          and belong to one academic year.
        </p>
      </div>

      {activeYear === null ? (
        <Card>
          <p className="text-sm text-slate-600">
            There is no active academic year, so sections cannot be created yet.
          </p>
          <Link
            href="/dashboard/admissions/academic-years/new"
            className="mt-3 inline-block text-sm font-medium text-brand-primary hover:underline"
          >
            Set up an academic year
          </Link>
        </Card>
      ) : null}

      {visible.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-600">
            This school has no active branches. Branches are created from the
            Super Admin panel, and grades belong to one.
          </p>
        </Card>
      ) : (
        <>
          {visible.length > 1 ? (
            <nav aria-label="Branches" className="flex flex-wrap gap-2">
              {visible.map((branch) => (
                <Link
                  key={branch.id}
                  href={`/dashboard/admissions/grades?branch=${branch.id}`}
                  aria-current={branch.id === selected?.id ? 'page' : undefined}
                  className={
                    branch.id === selected?.id
                      ? 'rounded-full bg-brand-primary px-3 py-1.5 text-sm font-medium text-white'
                      : 'rounded-full bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-200'
                  }
                >
                  {branch.name}
                </Link>
              ))}
            </nav>
          ) : null}

          {selected === null ? null : (
            <GradeSetupGrid
              key={selected.id}
              branchId={selected.id}
              branchName={selected.name}
              curriculumLevel={selected.curriculumLevel}
              academicYearId={activeYear?.id ?? ''}
              academicYearName={activeYear?.name ?? ''}
              canEdit={canEdit}
            />
          )}
        </>
      )}
    </div>
  );
}
