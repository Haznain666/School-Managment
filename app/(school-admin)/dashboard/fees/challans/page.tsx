import { AlertTriangle } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { VoucherRegisterTabs } from '@/components/fees/VoucherRegisterTabs';
import { Button } from '@/components/ui/Button';
import { PrincipalScopeNote } from '@/components/school/PrincipalScopeNote';
import { PageHeader } from '@/components/ui/PageHeader';
import {
  countUnbilledStudents,
  listAcademicYears,
  listGrades,
} from '@/lib/admissions-queries';
import { narrowGrades, visibleScopeFor } from '@/lib/principal-visibility';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Vouchers',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function ChallansPage() {
  const { claims, locationId, permissions } = await requireSchoolPermission('fees.read');

  const [academicYears, allGrades, visible] = await Promise.all([
    listAcademicYears(locationId),
    // A branch-scoped admin only ever sees their own branch's grades.
    listGrades(locationId, claims.branchId ?? undefined),
    // BR4 — Sprint 23, item 3. The class filter on the voucher register offers
    // a head their own classes; the register's rows are narrowed by the API
    // this component calls, which reads the same scope.
    visibleScopeFor({ locationId, role: claims.role, uid: claims.uid }),
  ]);

  const grades = narrowGrades(visible, allGrades);

  /*
   * The children this screen structurally cannot show — Sprint 28.
   *
   * The register is a list of vouchers, so a child who has never been billed
   * can never be a row in it however the tabs are filtered. The product owner
   * reported it in exactly those terms: *"neither do I see his voucher in the
   * vouchers section"*. There was nothing to see, and nothing said so.
   *
   * Narrowed by the same branch and scope the register itself is, so the number
   * counts children the reader can actually open. A count that included
   * campuses a branch administrator cannot see would send them looking for
   * students the link then does not list.
   */
  const unbilled = await countUnbilledStudents(locationId, {
    branchId: claims.branchId ?? undefined,
    scope: { branchIds: visible.branchIds, gradeIds: visible.gradeIds },
  });

  const canGenerate = permissions.includes('fees.write');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vouchers"
        description="Every bill your school has raised, with what has been paid against it."
        actions={
          canGenerate ? (
            <Link href="/dashboard/fees/challans/generate">
              <Button>Generate vouchers</Button>
            </Link>
          ) : null
        }
      />

      <PrincipalScopeNote note={visible.note} />

      {unbilled === 0 ? null : (
        <div
          role="alert"
          className="flex gap-3 rounded-lg bg-status-warning-subtle px-3 py-3 text-sm text-status-warning-onSubtle"
        >
          <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">
              {unbilled === 1
                ? '1 enrolled student has no voucher at all.'
                : `${String(unbilled)} enrolled students have no voucher at all.`}
            </p>
            <p className="mt-1">
              Nothing has been billed to them, so they appear nowhere on this
              register — a list of vouchers cannot show a child who has none.
              Raise the admission voucher from the student&rsquo;s own profile.
            </p>
            <Link
              href="/dashboard/admissions/students?feeStatus=not_billed"
              className="mt-2 inline-flex font-medium underline"
            >
              {unbilled === 1 ? 'See the student →' : 'See the students →'}
            </Link>
          </div>
        </div>
      )}

      <VoucherRegisterTabs
        academicYears={academicYears}
        grades={grades.map((grade) => ({ id: grade.id, label: grade.label }))}
        canGenerate={canGenerate}
      />
    </div>
  );
}
