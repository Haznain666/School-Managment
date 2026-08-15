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
 * Everything the school has sent this parent.
 *
 * Not permission-gated, like everything else on this portal: it is reached by
 * uid, and what is shown is decided by the delivery log — the rows the school
 * wrote when it sent each notice. A notice addressed to a class reaches the families of that class, so what appears here is what was sent to them or to one of their children's classes at the time it went out.
 */
export default async function ParentAnnouncementsPage() {
  const { claims, locationId } = await requireSchoolRole(['parent']);
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
        emptyMessage="The school has not sent you anything yet. Notices about your children&rsquo;s classes will appear here."
      />
    </div>
  );
}
