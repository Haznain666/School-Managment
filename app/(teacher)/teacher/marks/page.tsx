import type { Metadata } from 'next';
import Link from 'next/link';

import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import {
  RESIT_STATUS_LABELS,
  RESULT_STATUS_LABELS,
} from '@/db/schema/exam-subjects';
import { getActiveAcademicYear } from '@/lib/admissions-queries';
import { listTeacherPapers } from '@/lib/exam-queries';
import { requireSchoolRole } from '@/lib/school-guard';
import { getSchoolUserByUid } from '@/lib/school-queries';

export const metadata: Metadata = {
  title: 'Marks',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * A teacher's own papers.
 *
 * The list is the sections and subjects they are timetabled into — nothing
 * else is offered, and the results API repeats the same check on every read
 * and write, so a paper id typed into a request cannot reach another
 * teacher's class. Exactly the shape `/teacher/attendance` uses.
 */
export default async function TeacherMarksPage() {
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
              ? 'Your school has not opened an academic year yet, so there are no exams to mark.'
              : 'Your staff record is still being set up.'}
          </p>
        </Card>
      </div>
    );
  }

  const papers = await listTeacherPapers(locationId, profile.id, activeYear.id);

  return (
    <div className="space-y-6">
      <Heading />

      {papers.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-600">
            You have no papers to mark for {activeYear.name}. A paper appears
            here once your school schedules an exam for a class you are
            timetabled to teach that subject to.
          </p>
        </Card>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-slate-100">
            {papers.map((paper) => (
              <li
                key={paper.examSubjectId}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
              >
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">
                    {paper.subjectName} — {paper.sectionLabel}
                  </p>
                  <p className="text-xs text-slate-500">
                    {paper.examTitle} · {paper.termName} · {paper.examDate}
                  </p>
                </div>

                <div className="flex flex-nowrap items-center gap-2 whitespace-nowrap">
                  <Badge
                    variant={
                      paper.resultsStatus === 'published'
                        ? 'success'
                        : paper.resultsStatus === 'submitted'
                          ? 'warning'
                          : 'neutral'
                    }
                  >
                    {RESULT_STATUS_LABELS[paper.resultsStatus]}
                  </Badge>

                  {paper.resitStatus === 'none' ? null : (
                    <Badge variant="warning">
                      {RESIT_STATUS_LABELS[paper.resitStatus]}
                    </Badge>
                  )}

                  <Link
                    href={`/teacher/marks/${paper.examSubjectId}`}
                    className="text-sm font-medium text-brand-primary hover:underline"
                  >
                    Enter marks
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Heading() {
  return (
    <div>
      <h2 className="text-xl font-semibold text-slate-900">Marks</h2>
      <p className="mt-1 text-sm text-slate-500">
        Enter one paper for one class. Save as often as you like; submitting
        tells the school it is finished. Publishing is their step, not yours.
      </p>
    </div>
  );
}
