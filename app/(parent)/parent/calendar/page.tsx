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
 * When the school is closed, for a parent.
 *
 * ── No Saturday duty here, and that is the correct answer ────────────────
 * The roster is a staff rota. A family looking at this is asking whether their
 * child has school, and the honest answer for a Saturday is "no" — passing an
 * empty set is not a fallback, it is the fact. Showing a teacher's rota to a
 * parent would say the school is open on a day their child is not expected.
 */
export default async function ParentCalendarPage() {
  const { locationId } = await requireSchoolRole(['parent']);

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
