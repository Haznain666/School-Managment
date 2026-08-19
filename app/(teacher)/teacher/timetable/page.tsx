import type { Metadata } from 'next';

import { TeacherCalendar } from '@/components/academics/TeacherCalendar';
import { TimetableGrid } from '@/components/academics/TimetableGrid';
import { Card } from '@/components/ui/Card';
import { listSlotsForTeacher, listTeacherTimetable } from '@/lib/academics-queries';
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
          <p className="text-sm text-ink-muted">
            {activeYear === null
              ? 'Your school has not opened an academic year yet, so there is no timetable to show.'
              : 'Your staff record is still being set up. Your timetable will appear once it is complete.'}
          </p>
        </Card>
      </div>
    );
  }

  const [slots, entries] = await Promise.all([
    listSlotsForTeacher(locationId, profile.id, activeYear.id),
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

      {/*
        The same week, and two the grid cannot show.

        The grid answers "what shape is my week". The calendar answers "what am
        I doing on Thursday" and "how heavy is this month", which are the two
        questions a teacher actually opens this page with. There is no teacher
        selector: the id is the one resolved from their own session above, so
        there is nothing here that could be changed to show a colleague.
      */}
      <div>
        <h3 className="text-base font-semibold text-ink">By day and month</h3>
        <p className="mt-1 mb-4 text-sm text-ink-muted">
          The same periods, laid out against real dates.
        </p>

        <TeacherCalendar teacherId={profile.id} fixedTeacherName={profile.name} />
      </div>
    </div>
  );
}

function Heading({ yearName }: { yearName: string | null }) {
  return (
    <div>
      <h2 className="text-xl font-semibold text-ink">My timetable</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Every period you take{yearName === null ? '' : ` in ${yearName}`}, with the
        class and the room.
      </p>
    </div>
  );
}
