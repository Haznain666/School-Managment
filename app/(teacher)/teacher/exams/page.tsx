import type { Metadata } from 'next';

import { Card, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { getActiveAcademicYear } from '@/lib/admissions-queries';
import { listTeacherScheduleRows, type TeacherScheduleRow } from '@/lib/exam-queries';
import { requireSchoolRole } from '@/lib/school-guard';
import { getSchoolUserByUid } from '@/lib/school-queries';

export const metadata: Metadata = {
  title: 'My exams',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The teacher's own datesheet.
 *
 * ── Narrowed by the timetable, not by the school ─────────────────────────
 * `listTeacherScheduleRows` returns only the subjects this teacher is
 * timetabled to teach, exactly as `listTeacherPapers` does for marks entry. A
 * maths teacher should not have to read past the whole senior school to find
 * their Thursday, and a school-wide datesheet on a teacher's phone is a
 * document nobody scrolls twice.
 *
 * Max marks are absent for a class judged on performance descriptors, because
 * there is nothing for its papers to be out of.
 */
export default async function TeacherExamsPage() {
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
              ? 'Your school has not opened an academic year yet, so no exams have been scheduled.'
              : 'Your account is still being set up.'}
          </p>
        </Card>
      </div>
    );
  }

  const rows = await listTeacherScheduleRows(locationId, profile.id, activeYear.id);

  // Grouped by term in Node rather than by a second query: the list is one
  // teacher's papers for one year, which is tens of rows at most.
  const byTerm = new Map<string, { termName: string; rows: TeacherScheduleRow[] }>();
  for (const row of rows) {
    const bucket = byTerm.get(row.termId) ?? { termName: row.termName, rows: [] };
    bucket.rows.push(row);
    byTerm.set(row.termId, bucket);
  }

  return (
    <div className="space-y-6">
      <Heading />

      {rows.length === 0 ? (
        <EmptyState
          title="No exams scheduled for your classes"
          description="Your datesheet appears here once the school has published a schedule covering a class you teach."
        />
      ) : (
        [...byTerm.entries()].map(([termId, bucket]) => (
          <Card
            key={termId}
            header={<CardTitle title={bucket.termName} />}
            className="p-0"
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[38rem] text-sm">
                <thead>
                  <tr className="border-b border-line text-left">
                    <th scope="col" className="px-5 py-2 font-medium text-ink-muted">
                      Subject
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium text-ink-muted">
                      Class
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium text-ink-muted">
                      Date
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium text-ink-muted">
                      Starts
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium text-ink-muted">
                      Length
                    </th>
                    <th scope="col" className="px-5 py-2 font-medium text-ink-muted">
                      Out of
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {bucket.rows.map((row, index) => (
                    <tr key={`${row.scheduleId}-${row.subjectName}-${index}`}>
                      <th
                        scope="row"
                        className="px-5 py-2.5 text-left font-normal text-ink"
                      >
                        {row.subjectName}
                        <span className="block text-xs text-ink-muted">
                          {row.scheduleName}
                        </span>
                      </th>
                      <td className="px-3 py-2.5 text-ink-muted">{row.gradeName}</td>
                      <td className="px-3 py-2.5 text-ink">{row.examDate}</td>
                      <td className="px-3 py-2.5 text-ink-muted">
                        {row.startTime ?? '—'}
                      </td>
                      <td className="px-3 py-2.5 text-ink-muted">
                        {row.durationMinutes === null
                          ? '—'
                          : `${row.durationMinutes} min`}
                      </td>
                      <td className="px-5 py-2.5 text-ink-muted">
                        {row.mechanism === 'descriptors'
                          ? 'Descriptors'
                          : (row.maxMarks ?? '—')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ))
      )}
    </div>
  );
}

function Heading() {
  return (
    <PageHeader
      title="My exams"
      description="The datesheet rows for the subjects you teach, term by term."
    />
  );
}
