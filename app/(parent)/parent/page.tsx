import type { Metadata } from 'next';

import { PlaceholderModuleCard } from '@/components/school/PlaceholderModuleCard';
import { Card, CardTitle } from '@/components/ui/Card';
import { requireSchoolRole } from '@/lib/school-guard';
import { getSchoolUserByUid } from '@/lib/school-queries';

export const metadata: Metadata = {
  title: 'Parent dashboard',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function ParentDashboardPage() {
  const { claims, locationId } = await requireSchoolRole(['parent']);
  const profile = await getSchoolUserByUid(locationId, claims.uid);

  const firstName = (profile?.name ?? '').split(' ')[0] ?? '';

  return (
    <div className="space-y-6">
      <Card>
        <h2 className="text-lg font-semibold text-slate-900">
          Welcome{firstName === '' ? '' : `, ${firstName}`}.
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Your children will appear here once they are enrolled through the
          Admissions module. The parent-to-child link is created during
          enrolment, which is why nothing is listed yet.
        </p>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <PlaceholderModuleCard
          icon="👧"
          title="My Children"
          moduleName="Admissions"
          description="Each child's class, branch and attendance."
        />
        <PlaceholderModuleCard
          icon="💳"
          title="Fee Status"
          moduleName="Fee Management"
          description="Invoices, due dates and payment history per child."
        />
      </div>

      <Card header={<CardTitle title="Announcements" />}>
        <p className="text-sm text-slate-500">
          School announcements will appear here.
        </p>
      </Card>
    </div>
  );
}
