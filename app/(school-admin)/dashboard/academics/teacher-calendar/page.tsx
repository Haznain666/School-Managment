import type { Metadata } from 'next';

import { TeacherCalendar } from '@/components/academics/TeacherCalendar';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { listTeacherOptions } from '@/lib/academics-queries';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Teacher calendar',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Any teacher's day, week or month.
 *
 * The list of teachers is read server-side from the caller's own school. The
 * calendar itself is fetched by the client component, because a calendar is
 * paged through and each step as a server navigation would cost the ~1s
 * edge-to-origin hop STATE.md §5aq measured — for a change of one grid.
 */
export default async function TeacherCalendarPage() {
  const { locationId } = await requireSchoolPermission('academics.read');

  const teachers = await listTeacherOptions(locationId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Teacher calendar"
        description="What one teacher&rsquo;s day, week or month looks like — every class they take, in clock order, with the gaps visible."
      />

      {teachers.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-muted">
            No staff can be put in front of a class yet, so there is no calendar
            to show. Add teachers under People first.
          </p>
        </Card>
      ) : (
        <TeacherCalendar
          teachers={teachers}
          teacherId={teachers[0]?.id ?? ''}
        />
      )}
    </div>
  );
}
