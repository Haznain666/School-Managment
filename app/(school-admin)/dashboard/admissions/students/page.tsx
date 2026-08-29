import type { Metadata } from 'next';
import Link from 'next/link';

import { StudentTable } from '@/components/admissions/StudentTable';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { listAcademicYears, listAdmissionsBranches } from '@/lib/admissions-queries';
import { describeScope, resolvePrincipalScope } from '@/lib/principal-resolver';
import { requireSchoolPermission } from '@/lib/school-guard';
import { getSchoolUserByUid } from '@/lib/school-queries';

export const metadata: Metadata = {
  title: 'Students',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function StudentsPage() {
  const { claims, locationId, permissions } =
    await requireSchoolPermission('students.read');

  const me = await getSchoolUserByUid(locationId, claims.uid);

  const [branches, academicYears, scope] = await Promise.all([
    listAdmissionsBranches(locationId),
    listAcademicYears(locationId),
    resolvePrincipalScope(locationId, claims.role, me?.id ?? null),
  ]);

  // The permission the enrollment route itself now checks, rather than a
  // hand-kept list of roles beside it. Sprint 18.
  const canEnroll = permissions.includes('students.create');

  // BR4. The list itself is narrowed by the API; this is the sentence that
  // stops a narrowed head reading a short list as a broken page.
  const scopeNote = describeScope(scope);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Students"
        description="Everyone enrolled, by academic year. A student with no placement in the selected year does not appear under it."
        actions={
          <div className="flex gap-3">
            {/* Export lands in a later sprint; shown disabled so the absence is
                deliberate rather than looking like a missing feature. */}
            <Button variant="secondary" disabled title="Coming in a later sprint">
              Export
            </Button>

            {canEnroll ? (
              <Link href="/dashboard/admissions/enroll">
                <Button>Enroll student</Button>
              </Link>
            ) : null}
          </div>
        }
      />

      {scopeNote === null ? null : (
        <Card>
          <p className="text-sm text-ink-muted">{scopeNote}</p>
        </Card>
      )}

      {academicYears.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-muted">
            No academic years exist yet, so there is nothing to list.
          </p>
          <Link
            href="/dashboard/admissions/academic-years/new"
            className="mt-3 inline-block text-sm font-medium text-brand-primary hover:underline"
          >
            Set up an academic year
          </Link>
        </Card>
      ) : (
        <StudentTable
          branches={branches}
          academicYears={academicYears}
          lockedBranchId={claims.branchId}
        />
      )}
    </div>
  );
}
