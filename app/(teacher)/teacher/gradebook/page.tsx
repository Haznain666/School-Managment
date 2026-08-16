import type { Metadata } from 'next';
import Link from 'next/link';

import { Badge } from '@/components/ui/Badge';
import { Card, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { listTeacherSections } from '@/lib/academics-queries';
import { getActiveAcademicYear } from '@/lib/admissions-queries';
import { listExams } from '@/lib/exam-queries';
import { requireSchoolRole } from '@/lib/school-guard';
import { getSchoolUserByUid } from '@/lib/school-queries';

export const metadata: Metadata = {
  title: 'Gradebook',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The teacher's gradebook — every exam their classes have sat.
 *
 * ── Why this is not the marks screen ─────────────────────────────────────
 * `/teacher/marks` is entry: one paper, one class, a column of numbers to type.
 * This is the read: a whole class across every subject, which is the view a
 * teacher wants at a parents' evening and cannot assemble from the entry
 * screen. Sprint 9 built the grid (`getTabulation`) for a principal reviewing a
 * term; this is the same grid reached from the other end.
 *
 * ── Only the teacher's own classes ───────────────────────────────────────
 * The exam list is filtered to the sections `listTeacherSections` returns — the
 * same authorisation list the register and the marks screen use. The detail
 * page repeats the check rather than trusting the link that reached it.
 */
export default async function TeacherGradebookPage() {
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
              ? 'Your school has not opened an academic year yet, so there are no results to show.'
              : 'Your staff record is still being set up.'}
          </p>
        </Card>
      </div>
    );
  }

  const mySections = await listTeacherSections(locationId, profile.id, activeYear.id);

  // One query per section rather than one per exam. A teacher has a handful of
  // classes, so this is a small fixed cost — the per-row round trip Sprint 10
  // removed three times would be one query per *exam*.
  const bySection = await Promise.all(
    mySections.map(async (section) => ({
      section,
      exams: await listExams(locationId, { sectionId: section.sectionId }),
    })),
  );

  const anyExams = bySection.some((entry) => entry.exams.length > 0);

  return (
    <div className="space-y-6">
      <Heading />

      {mySections.length === 0 ? (
        <EmptyState
          title={`You are not timetabled into any class for ${activeYear.name}`}
          description="A class appears here once your school puts you on its timetable."
        />
      ) : !anyExams ? (
        <EmptyState
          title="No exams have been scheduled for your classes"
          description="An exam appears here as soon as your school schedules one for a class you teach."
        />
      ) : (
        bySection
          .filter((entry) => entry.exams.length > 0)
          .map(({ section, exams }) => (
            <Card
              key={section.sectionId}
              header={<CardTitle title={section.label} />}
              className="p-0"
            >
              <ul className="divide-y divide-line">
                {exams.map((exam) => (
                  <li
                    key={exam.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-ink">{exam.title}</p>
                      <p className="text-xs text-ink-muted">
                        {exam.termName} · {exam.examDate} ·{' '}
                        {exam.paperCount} paper{exam.paperCount === 1 ? '' : 's'}
                      </p>
                    </div>

                    <div className="flex flex-nowrap items-center gap-2 whitespace-nowrap">
                      <Badge variant={exam.termIsPublished ? 'success' : 'neutral'}>
                        {exam.termIsPublished ? 'Term published' : 'In progress'}
                      </Badge>
                      <Link
                        href={`/teacher/gradebook/${exam.id}`}
                        className="text-sm font-medium text-brand-primary hover:underline"
                      >
                        Open gradebook
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          ))
      )}
    </div>
  );
}

function Heading() {
  return (
    <PageHeader
      title="Gradebook"
      description="Your classes across every subject of an exam. Marks that have not been published yet are marked as such — they are what you and your colleagues have entered, not what a parent can see."
    />
  );
}
