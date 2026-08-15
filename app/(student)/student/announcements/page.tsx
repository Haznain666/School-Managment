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
 * Everything the school has sent this student.
 *
 * Not permission-gated, like everything else on this portal: it is reached by
 * uid, and what is shown is decided by the delivery log — the rows the school
 * wrote when it sent each notice. A notice sent to their class in April still appears after they move class in May, because the log records who it was sent to rather than who is in that class today.
 */
export default async function StudentAnnouncementsPage() {
  const { claims, locationId } = await requireSchoolRole(['student']);
  const me = await getSchoolUserByUid(locationId, claims.uid);

  const notices = me === null ? [] : await listNoticesFor(locationId, me.id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Announcements"
        description="Notices from your school, newest first."
      />

      <NoticeBoard
        notices={notices}
        emptyMessage="Nothing yet. Notices from your school and your class will appear here."
      />
    </div>
  );
}
