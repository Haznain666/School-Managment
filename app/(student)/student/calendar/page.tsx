import type { Metadata } from 'next';

import { HolidayCalendar } from '@/components/calendar/HolidayCalendar';
import { PageHeader } from '@/components/ui/PageHeader';
import { listHolidays } from '@/lib/holiday-queries';
import { requireSchoolRole } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Calendar',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * When the school is closed, for a pupil.
 *
 * Read-only and without the Saturday rota, for the same reason the parent's is:
 * the roster is a staff rota, and a pupil asking whether they have school on
 * Saturday is asking a different question from a teacher asking whether they
 * are on duty.
 */
export default async function StudentCalendarPage() {
  const { locationId } = await requireSchoolRole(['student']);

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const from = new Date(Date.UTC(year - 1, month - 1, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(year + 1, month, 0)).toISOString().slice(0, 10);

  const holidays = await listHolidays(locationId, from, to);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Calendar"
        description="When the school is closed. Dates worked out from the Islamic calendar are marked tentative until the school confirms them."
      />

      <HolidayCalendar
        holidays={holidays}
        initialMonth={`${String(year)}-${String(month).padStart(2, '0')}`}
      />
    </div>
  );
}
