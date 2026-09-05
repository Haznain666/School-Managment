import type { Metadata } from 'next';

import { CalendarManager } from '@/components/calendar/CalendarManager';
import { PageHeader } from '@/components/ui/PageHeader';
import { saturdayOrdinalsForUser } from '@/lib/holiday-queries';
import { requireSchoolRole } from '@/lib/school-guard';
import { callerHasPermission } from '@/lib/school-guard';
import { getSchoolUserByUid } from '@/lib/school-queries';
import { ADMIN_PORTAL_ROLES } from '@/types/school-auth';

export const metadata: Metadata = {
  title: 'Calendar',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The school's own calendar.
 *
 * ── Reading it is not permission-gated, and that is deliberate ───────────
 * Every role on this portal sees it. A coordinator who cannot see when the
 * school is shut is a coordinator scheduling a datesheet over Eid.
 * `calendar.manage` decides who may *change* it, and that is read here so the
 * buttons are absent rather than present-and-refused.
 */
export default async function CalendarPage() {
  const { claims, locationId } = await requireSchoolRole(ADMIN_PORTAL_ROLES);

  const [me, canManage] = await Promise.all([
    getSchoolUserByUid(locationId, claims.uid),
    callerHasPermission('calendar.manage'),
  ]);

  // The reader's own Saturday duty, so the grid marks the ones they come in
  // for. A person with no staff record gets their role's policy, and somebody
  // with neither gets none — which is the right answer rather than a fallback.
  const saturdayOrdinals = await saturdayOrdinalsForUser(
    locationId,
    me?.id ?? null,
    claims.role,
  );

  const now = new Date();
  const initialMonth = `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Calendar"
        description="When the school is closed. Sundays are always off, Saturdays follow the duty roster, and every date worked out from the Islamic calendar is marked tentative until somebody confirms it."
      />

      <CalendarManager
        canManage={canManage}
        initialMonth={initialMonth}
        saturdayOrdinals={saturdayOrdinals}
      />
    </div>
  );
}
