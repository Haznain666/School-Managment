import type { Metadata } from 'next';

import { PlaceholderModuleCard } from '@/components/school/PlaceholderModuleCard';
import { Card, CardTitle } from '@/components/ui/Card';
import { requireSchoolRole } from '@/lib/school-guard';
import { getSchoolUserByUid } from '@/lib/school-queries';

export const metadata: Metadata = {
  title: 'Student dashboard',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function StudentDashboardPage() {
  const { claims, locationId } = await requireSchoolRole(['student']);
  const profile = await getSchoolUserByUid(locationId, claims.uid);

  const firstName = (profile?.name ?? '').split(' ')[0] ?? '';

  return (
    <div className="space-y-6">
      <Card>
        <h2 className="text-lg font-semibold text-slate-900">
          Welcome{firstName === '' ? '' : `, ${firstName}`}.
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Your timetable, results and fee status will appear here as your school
          enables each module.
        </p>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <PlaceholderModuleCard
          icon="🗓️"
          title="Today's Schedule"
          moduleName="Academics"
          description="Your periods, rooms and teachers for today."
        />
        <PlaceholderModuleCard
          icon="📈"
          title="My Grades"
          moduleName="Academics"
          description="Results by subject and term."
        />
        <PlaceholderModuleCard
          icon="💳"
          title="Fee Balance"
          moduleName="Fee Management"
          description="What is due, what is paid, and when."
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
