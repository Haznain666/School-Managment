import type { Metadata } from 'next';

import { PlaceholderModuleCard } from '@/components/school/PlaceholderModuleCard';
import { Card, CardTitle } from '@/components/ui/Card';
import { requireSchoolRole } from '@/lib/school-guard';
import { getSchoolUserByUid } from '@/lib/school-queries';

export const metadata: Metadata = {
  title: 'Teacher dashboard',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Time-of-day greeting in the school's own timezone context. */
function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export default async function TeacherDashboardPage() {
  const { claims, locationId } = await requireSchoolRole(['teacher']);
  const profile = await getSchoolUserByUid(locationId, claims.uid);

  const firstName = (profile?.name ?? '').split(' ')[0] ?? '';

  return (
    <div className="space-y-6">
      <Card>
        <h2 className="text-lg font-semibold text-ink">
          {greeting()}
          {firstName === '' ? '' : `, ${firstName}`}. Here is your day.
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          Your classes and attendance tools appear here once the Academics
          module is enabled for your school.
        </p>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <PlaceholderModuleCard
          icon="📚"
          title="My Classes Today"
          moduleName="Academics"
          description="Your timetable for today, with attendance for each period."
        />
        <PlaceholderModuleCard
          icon="✅"
          title="Pending Tasks"
          moduleName="Academics"
          description="Marking, attendance gaps and anything else awaiting you."
        />
      </div>

      <Card header={<CardTitle title="Announcements" />}>
        <p className="text-sm text-ink-muted">
          School announcements will appear here.
        </p>
      </Card>
    </div>
  );
}
