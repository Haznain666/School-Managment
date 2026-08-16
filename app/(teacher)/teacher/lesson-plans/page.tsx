import type { Metadata } from 'next';

import { LessonPlanBoard } from '@/components/teacher/LessonPlanBoard';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { listSubjects, listTeacherSections } from '@/lib/academics-queries';
import { getActiveAcademicYear } from '@/lib/admissions-queries';
import { requireSchoolRole } from '@/lib/school-guard';
import { getSchoolUserByUid } from '@/lib/school-queries';

export const metadata: Metadata = {
  title: 'Lesson plans',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * A teacher's weekly lesson plans.
 *
 * The class list offered is `listTeacherSections` — the sections they are
 * timetabled into — and the API repeats that check with the same predicate the
 * register uses, so a section id typed into a request cannot file a plan
 * against another teacher's class.
 */
export default async function TeacherLessonPlansPage() {
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
          <p className="text-sm text-ink-muted">
            {activeYear === null
              ? 'Your school has not opened an academic year yet, so there is nothing to plan against.'
              : 'Your staff record is still being set up.'}
          </p>
        </Card>
      </div>
    );
  }

  const [mySections, subjects] = await Promise.all([
    listTeacherSections(locationId, profile.id, activeYear.id),
    listSubjects(locationId),
  ]);

  return (
    <div className="space-y-6">
      <Heading />

      <LessonPlanBoard
        sections={mySections.map((section) => ({
          id: section.sectionId,
          label: section.label,
        }))}
        subjects={subjects.map((subject) => ({ id: subject.id, label: subject.name }))}
      />
    </div>
  );
}

function Heading() {
  return (
    <PageHeader
      title="Lesson plans"
      description="What you intend to cover, week by week. A draft is yours alone; sharing makes it visible to your coordinators and heads — nothing is sent to anybody."
    />
  );
}
