import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { MarksEntry } from '@/components/exams/MarksEntry';
import { ATTEMPT_ORIGINAL, ATTEMPT_RESIT } from '@/db/schema';
import { getMarksSheet } from '@/lib/exam-queries';
import { requireSchoolPermission } from '@/lib/school-guard';
import { isUuid } from '@/lib/validation';

export const metadata: Metadata = {
  title: 'Marks',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Marks entry from the administrative side.
 *
 * Gated on `exams.read` rather than `results.enter`, and the screen itself is
 * read-only without the stronger permission: a principal checking a paper
 * before publishing it should be able to look at it. The API refuses the save
 * either way, so the page is not the gate.
 *
 * The teacher's own route to the same screen is `/teacher/marks`, which is
 * additionally narrowed to the papers they are timetabled to teach.
 */
export default async function MarksEntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ examId: string; examSubjectId: string }>;
  searchParams: Promise<{ attempt?: string }>;
}) {
  const { locationId, permissions } = await requireSchoolPermission('exams.read');
  const { examId, examSubjectId } = await params;
  const { attempt: rawAttempt } = await searchParams;

  if (!isUuid(examId) || !isUuid(examSubjectId)) notFound();

  const attempt = rawAttempt === String(ATTEMPT_RESIT) ? ATTEMPT_RESIT : ATTEMPT_ORIGINAL;

  const sheet = await getMarksSheet(locationId, examSubjectId, attempt);
  if (sheet === null || sheet.paper.examId !== examId) notFound();

  return (
    <div className="space-y-6">
      <Link
        href={`/dashboard/exams/${examId}`}
        className="text-sm font-medium text-brand-primary hover:underline"
      >
        ← Back to the exam
      </Link>

      <MarksEntry
        paper={sheet.paper}
        students={sheet.students}
        initialAttempt={attempt}
        canEnter={permissions.includes('results.enter')}
      />
    </div>
  );
}
