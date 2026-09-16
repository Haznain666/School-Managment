import type { Metadata } from 'next';

import { HrNav } from '@/components/hr/HrNav';
import { StaffCalendarManager } from '@/components/hr/StaffCalendarManager';
import { PageHeader } from '@/components/ui/PageHeader';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Staff calendars',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The two staff calendars, and the rule that decides what a leave day costs.
 *
 * Read on `leave.read` and written on `leave.manage`. The split is the same one
 * the permission catalogue draws everywhere else in this round: the person who
 * sets the quota is not necessarily the person who signs off against it, and a
 * coordinator who approves leave should be able to see why five days became
 * four without being able to change the reason.
 */
export default async function StaffCalendarsPage() {
  const { permissions } = await requireSchoolPermission('leave.read');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff calendars"
        description="Teaching and non-teaching staff do not share a year. Gazetted holidays appear on both automatically — what is set here are the exceptions, and whether a holiday inside a leave range is counted."
      />

      <HrNav />

      <StaffCalendarManager canEdit={permissions.includes('leave.manage')} />
    </div>
  );
}
