import type { Metadata } from 'next';

import { HolidayCalendar } from '@/components/calendar/HolidayCalendar';
import { PageHeader } from '@/components/ui/PageHeader';
import { listHolidays, saturdayOrdinalsForUser } from '@/lib/holiday-queries';
import { requireSchoolRole } from '@/lib/school-guard';
import { getSchoolUserByUid } from '@/lib/school-queries';

export const metadata: Metadata = {
  title: 'Calendar',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The school's calendar, read-only, with this teacher's own Saturdays marked.
 *
 * ── Why the Saturdays are resolved on the server ─────────────────────────
 * They are the answer to *am I in this week*, and it comes from two rows this
 * portal cannot see: the teacher's own `staff.saturday_ordinals` override and
 * their role's policy. Resolving it here means the grid draws a fact rather
 * than a guess, and it is the same function `attendanceTallyByStaff` uses when
 * it decides whether an absence on a Saturday should be docked — one answer,
 * two callers, no drift.
 */
export default async function TeacherCalendarPage() {
  const { claims, locationId } = await requireSchoolRole(['teacher']);
  const me = await getSchoolUserByUid(locationId, claims.uid);

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  // Twelve months either side, which is what somebody planning a year looks at
  // and what lets the grid page back and forward without a refetch.
  const from = new Date(Date.UTC(year - 1, month - 1, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(year + 1, month, 0)).toISOString().slice(0, 10);

  const [holidays, saturdayOrdinals] = await Promise.all([
    listHolidays(locationId, from, to),
    saturdayOrdinalsForUser(locationId, me?.id ?? null, claims.role),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Calendar"
        description="When the school is closed, and which Saturdays you are on duty."
      />

      <HolidayCalendar
        holidays={holidays}
        initialMonth={`${String(year)}-${String(month).padStart(2, '0')}`}
        saturdayOrdinals={saturdayOrdinals}
      />
    </div>
  );
}
