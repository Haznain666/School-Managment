import type { Metadata } from 'next';

import { TimetableGrid } from '@/components/academics/TimetableGrid';
import { Card } from '@/components/ui/Card';
import {
  getStudentPlacement,
  listTimetableEntries,
  listTimetableSlots,
} from '@/lib/academics-queries';
import { getActiveAcademicYear } from '@/lib/admissions-queries';
import { requireSchoolRole } from '@/lib/school-guard';
import { getSchoolUserByUid } from '@/lib/school-queries';

export const metadata: Metadata = {
  title: 'My timetable',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * A student's own week.
 *
 * The section is resolved from the uid in their verified session — school user,
 * then profile, then this year's active enrolment. There is no id in the URL, so
 * a student cannot ask for another class's timetable.
 */
export default async function StudentTimetablePage() {
  const { claims, locationId } = await requireSchoolRole(['student']);

  const [profile, activeYear] = await Promise.all([
    getSchoolUserByUid(locationId, claims.uid),
    getActiveAcademicYear(locationId),
  ]);

  const placement =
    profile === null || activeYear === null
      ? null
      : await getStudentPlacement(locationId, profile.id, activeYear.id);

  if (placement === null || activeYear === null) {
    return (
      <div className="space-y-6">
        <Heading subtitle={null} />
        <Card>
          <p className="text-sm text-slate-600">
            {activeYear === null
              ? 'Your school has not opened an academic year yet, so there is no timetable to show.'
              : 'No placement is recorded for you this year, so there is no timetable to show yet.'}
          </p>
        </Card>
      </div>
    );
  }

  const [slots, entries] = await Promise.all([
    listTimetableSlots(locationId, { activeOnly: true }),
    listTimetableEntries(locationId, {
      sectionId: placement.sectionId,
      academicYearId: activeYear.id,
    }),
  ]);

  return (
    <div className="space-y-6">
      <Heading
        subtitle={`${placement.gradeName} — ${placement.sectionName} · ${activeYear.name}`}
      />

      <TimetableGrid
        slots={slots}
        entries={entries.map((entry) => ({
          slotId: entry.slotId,
          dayOfWeek: entry.dayOfWeek,
          subjectName: entry.subjectName,
          subjectCode: entry.subjectCode,
          subjectColor: entry.subjectColor,
          subLabel: entry.teacherName,
          room: entry.room,
        }))}
        emptyMessage="Your class timetable has not been published yet."
      />
    </div>
  );
}

function Heading({ subtitle }: { subtitle: string | null }) {
  return (
    <div>
      <h2 className="text-xl font-semibold text-slate-900">My timetable</h2>
      <p className="mt-1 text-sm text-slate-500">
        {subtitle ?? 'Your periods, teachers and rooms for the week.'}
      </p>
    </div>
  );
}
