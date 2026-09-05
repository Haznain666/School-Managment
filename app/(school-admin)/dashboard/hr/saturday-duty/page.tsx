import type { Metadata } from 'next';

import { SaturdayDutyManager } from '@/components/hr/SaturdayDutyManager';
import { PageHeader } from '@/components/ui/PageHeader';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Saturday duty',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Who comes in on which Saturday.
 *
 * ── Why this is `hr.read` and not `calendar.manage` ──────────────────────
 * The roster is a staff rota, not a closure. A Branch Administrator may close
 * their campus for a rally without being able to change who is expected in on
 * the third Saturday — those are different decisions belonging to different
 * people, and running them off one key would give whoever maintains the
 * calendar authority over the rota.
 *
 * What it *does* decide is what the payroll counts: `attendanceTallyByStaff`
 * excludes a date that was not a working day for that person, which is what
 * stops a teacher being docked for a Saturday she was never expected on.
 */
export default async function SaturdayDutyPage() {
  const { permissions } = await requireSchoolPermission('hr.read');

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Saturday duty"
        description="Sundays are always off. A Saturday is a working day only for the people rostered on it — by role, and by person where somebody's answer differs from their colleagues'."
      />

      <SaturdayDutyManager canWrite={permissions.includes('hr.write')} />
    </div>
  );
}
