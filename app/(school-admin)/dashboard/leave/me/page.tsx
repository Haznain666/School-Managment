import type { Metadata } from 'next';

import { LeaveSelfService } from '@/components/leave/LeaveSelfService';
import { PageHeader } from '@/components/ui/PageHeader';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'My leave',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Applying for your own leave, from the administrative dashboard.
 *
 * Every staff portal user applies from their own portal, and for a Coordinator,
 * a Section Head, a Vice Principal, an accountant or an HR manager that portal
 * is this one. The component is the same one `/teacher/leave` renders: the act
 * is identical and two copies of a form would be two things to keep in step
 * with one set of rules.
 */
export default async function MyLeavePage() {
  await requireSchoolPermission('leave.request');

  return (
    <div className="space-y-6">
      <PageHeader
        title="My leave"
        description="Apply for leave, see what you have left, and read what was decided."
      />

      <LeaveSelfService />
    </div>
  );
}
