import type { Metadata } from 'next';

import { AttendanceMarker } from '@/components/academics/AttendanceMarker';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { listTeacherSections } from '@/lib/academics-queries';
import { getActiveAcademicYear, listGrades, listSections } from '@/lib/admissions-queries';
import { requireSchoolRole } from '@/lib/school-guard';
import { getSchoolUserByUid } from '@/lib/school-queries';

export const metadata: Metadata = {
  title: 'Attendance',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * A teacher taking the register.
 *
 * The class list is the sections they are timetabled into — nothing else is
 * offered, and the API repeats the same check on every read and write, so a
 * section id typed into a request cannot reach another teacher's class.
 */
export default async function TeacherAttendancePage() {
  const { claims, locationId } = await requireSchoolRole(['teacher']);

  const [profile, activeYear] = await Promise.all([
    getSchoolUserByUid(locationId, claims.uid),
    getActiveAcademicYear(locationId),
  ]);

  if (profile === null || activeYear === null) {
    return (
      <div className="space-y-6">
        <Heading />
        <Card>
          <p className="text-sm text-slate-600">
            {activeYear === null
              ? 'Your school has not opened an academic year yet, so there is no register to take.'
              : 'Your staff record is still being set up.'}
          </p>
        </Card>
      </div>
    );
  }

  const teacherSections = await listTeacherSections(
    locationId,
    profile.id,
    activeYear.id,
  );

  if (teacherSections.length === 0) {
    return (
      <div className="space-y-6">
        <Heading />
        <Card>
          <p className="text-sm text-slate-600">
            You are not timetabled into any section for {activeYear.name}, so
            there is no register for you to take. Your school admin assigns
            classes on the timetable.
          </p>
        </Card>
      </div>
    );
  }

  const allowedSectionIds = new Set(
    teacherSections.map((section) => section.sectionId),
  );

  const [sections, grades] = await Promise.all([
    listSections(locationId, { academicYearId: activeYear.id }),
    listGrades(locationId),
  ]);

  const mySections = sections.filter((section) => allowedSectionIds.has(section.id));
  const myGradeIds = new Set(mySections.map((section) => section.gradeId));

  return (
    <div className="space-y-6">
      <Heading />

      <AttendanceMarker
        academicYears={[
          { id: activeYear.id, name: activeYear.name, isActive: true },
        ]}
        grades={grades
          .filter((grade) => myGradeIds.has(grade.id))
          .map((grade) => ({ id: grade.id, label: grade.label }))}
        sections={mySections.map((section) => ({
          id: section.id,
          gradeId: section.gradeId,
          academicYearId: section.academicYearId,
          name: section.name,
        }))}
        scopeNote="Only the classes you are timetabled into are listed."
      />
    </div>
  );
}

function Heading() {
  return (
    <PageHeader
      title="Attendance"
      description="Take the register for one of your classes. Saving again corrects the same day rather than adding to it."
    />
  );
}
