import type { Metadata } from 'next';

import { TimetableGrid } from '@/components/academics/TimetableGrid';
import { Card } from '@/components/ui/Card';
import { listTeacherTimetable, listTimetableSlots } from '@/lib/academics-queries';
import { getActiveAcademicYear } from '@/lib/admissions-queries';
import { requireSchoolRole } from '@/lib/school-guard';
import { getSchoolUserByUid } from '@/lib/school-queries';

export const metadata: Metadata = {
  title: 'My timetable',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * A teacher's own week.
 *
 * The teacher id is resolved from the uid in their verified session, never from
 * the URL — there is no parameter here that could be changed to show somebody
 * else's schedule. It is read-only for the same reason: a teacher is told their
 * timetable, they do not set it.
 */
export default async function TeacherTimetablePage() {
  const { claims, locationId } = await requireSchoolRole(['teacher']);

  const [profile, activeYear] = await Promise.all([
    getSchoolUserByUid(locationId, claims.uid),
    getActiveAcademicYear(locationId),
  ]);

  if (profile === null || activeYear === null) {
    return (
      <div className="space-y-6">
        <Heading yearName={activeYear?.name ?? null} />
        <Card>
          <p className="text-sm text-slate-600">
            {activeYear === null
              ? 'Your school has not opened an academic year yet, so there is no timetable to show.'
              : 'Your staff record is still being set up. Your timetable will appear once it is complete.'}
          </p>
        </Card>
      </div>
    );
  }

  const [slots, entries] = await Promise.all([
    listTimetableSlots(locationId, { activeOnly: true }),
    listTeacherTimetable(locationId, profile.id, activeYear.id),
  ]);

  return (
    <div className="space-y-6">
      <Heading yearName={activeYear.name} />

      <TimetableGrid
        slots={slots}
        entries={entries.map((entry) => ({
          slotId: entry.slotId,
          dayOfWeek: entry.dayOfWeek,
          subjectName: entry.subjectName,
          subjectCode: entry.subjectCode,
          subjectColor: entry.subjectColor,
          subLabel: `${entry.gradeName} — ${entry.sectionName}`,
          room: entry.room,
        }))}
        emptyMessage="You have no periods scheduled yet. Your school admin builds the timetable."
      />
    </div>
  );
}

function Heading({ yearName }: { yearName: string | null }) {
  return (
    <div>
      <h2 className="text-xl font-semibold text-slate-900">My timetable</h2>
      <p className="mt-1 text-sm text-slate-500">
        Every period you take{yearName === null ? '' : ` in ${yearName}`}, with the
        class and the room.
      </p>
    </div>
  );
}
