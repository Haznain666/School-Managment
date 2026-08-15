import type { Metadata } from 'next';

import { NoticeBoard } from '@/components/comms/NoticeBoard';
import { PageHeader } from '@/components/ui/PageHeader';
import { listNoticesFor } from '@/lib/announcement-queries';
import { requireSchoolRole } from '@/lib/school-guard';
import { getSchoolUserByUid } from '@/lib/school-queries';

export const metadata: Metadata = {
  title: 'Announcements',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Everything the school has sent this teacher.
 *
 * Not permission-gated, like everything else on this portal: it is reached by
 * uid, and what is shown is decided by the delivery log — the rows the school
 * wrote when it sent each notice. Staff are reached by addressing their role, never by addressing a class they teach — a class audience is that class's families.
 */
export default async function TeacherAnnouncementsPage() {
  const { claims, locationId } = await requireSchoolRole(['teacher']);
  const me = await getSchoolUserByUid(locationId, claims.uid);

  const notices = me === null ? [] : await listNoticesFor(locationId, me.id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Announcements"
        description="Notices from the school, newest first."
      />

      <NoticeBoard
        notices={notices}
        emptyMessage="Nothing yet. Notices sent to staff will appear here."
      />
    </div>
  );
}
