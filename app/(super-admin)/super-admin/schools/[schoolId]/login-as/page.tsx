import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { SchoolLoginAsForm } from '@/app/(super-admin)/super-admin/schools/[schoolId]/login-as/SchoolLoginAsForm';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { getSchoolById } from '@/lib/schools';

export const metadata: Metadata = {
  title: 'Sign in to school',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * "Login as Admin" — the operator's own way into a customer's portal.
 *
 * Middleware has already established that a panel session exists; this screen
 * asks for the password again before the tenant is opened. Reading a school's
 * student and fee records is a different act from administering the platform,
 * and it should take a deliberate one.
 */
export default async function SchoolLoginAsPage({
  params,
}: {
  params: Promise<{ schoolId: string }>;
}) {
  const { schoolId } = await params;
  const school = await getSchoolById(schoolId);

  if (school === null) notFound();

  return (
    <div className="max-w-xl space-y-6">
      <PageHeader
        breadcrumbs={[
          { label: 'Schools', href: '/super-admin/schools' },
          { label: school.schoolName, href: `/super-admin/schools/${school.id}` },
          { label: 'Sign in as admin' },
        ]}
        title={`Sign in to ${school.schoolName}`}
        description="Enter your Super Admin credentials to open this school’s admin portal. This uses your own operator account — the school’s own staff sign in with their email and password, and that is unchanged."
      />

      {school.isActive ? null : (
        <Card>
          <p className="text-sm text-status-warning-onSubtle">
            This school is deactivated, so its portal is closed to everyone
            including you. Reactivate it from the school list first.
          </p>
        </Card>
      )}

      <SchoolLoginAsForm schoolId={school.id} schoolName={school.schoolName} />

      <Card>
        <h3 className="text-sm font-semibold text-ink">What this does</h3>
        <ul className="mt-2 space-y-1.5 text-sm text-ink-muted">
          <li>
            Opens{' '}
            <span className="font-mono text-xs">{school.slug}</span> with full
            School Administrator access.
          </li>
          <li>
            The session is recorded as the platform Super Admin, and the school
            portal says so on screen while you are in it.
          </li>
          <li>
            It grants nothing outside this one school — every query is still
            scoped to its Location ID.
          </li>
        </ul>
      </Card>
    </div>
  );
}
