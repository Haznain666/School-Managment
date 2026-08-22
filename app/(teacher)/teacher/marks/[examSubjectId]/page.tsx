import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { MarksEntry } from '@/components/exams/MarksEntry';
import { Card } from '@/components/ui/Card';
import { ATTEMPT_ORIGINAL, ATTEMPT_RESIT } from '@/db/schema';
import { getMarksSheet, teacherOwnsPaper } from '@/lib/exam-queries';
import { permissionsForRole } from '@/lib/permission-queries';
import { requireSchoolRole } from '@/lib/school-guard';
import { getSchoolUserByUid } from '@/lib/school-queries';
import { isUuid } from '@/lib/validation';

export const metadata: Metadata = {
  title: 'Enter marks',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * One of the teacher's own papers.
 *
 * `teacherOwnsPaper` is checked here as well as in the API. The page check
 * decides what renders; the API check is what actually protects the data, and
 * neither is allowed to stand in for the other.
 */
export default async function TeacherMarksEntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ examSubjectId: string }>;
  searchParams: Promise<{ attempt?: string }>;
}) {
  const { claims, locationId } = await requireSchoolRole(['teacher']);
  const { examSubjectId } = await params;
  const { attempt: rawAttempt } = await searchParams;

  if (!isUuid(examSubjectId)) notFound();

  const [profile, permissions] = await Promise.all([
    getSchoolUserByUid(locationId, claims.uid),
    permissionsForRole(locationId, claims.role),
  ]);

  if (profile === null) notFound();

  if (!(await teacherOwnsPaper(locationId, profile.id, examSubjectId))) {
    return (
      <Card>
        <p className="text-sm text-ink-muted">
          That paper is not one of yours. You can only enter marks for a subject
          you are timetabled to teach to that class.
        </p>
        <Link
          href="/teacher/marks"
          className="mt-4 inline-block text-sm font-medium text-brand-primary hover:underline"
        >
          Back to my papers
        </Link>
      </Card>
    );
  }

  const attempt = rawAttempt === String(ATTEMPT_RESIT) ? ATTEMPT_RESIT : ATTEMPT_ORIGINAL;
  const sheet = await getMarksSheet(locationId, examSubjectId, attempt);
  if (sheet === null) notFound();

  return (
    <div className="space-y-6">
      <Link
        href="/teacher/marks"
        className="text-sm font-medium text-brand-primary hover:underline"
      >
        ← My papers
      </Link>

      <MarksEntry
        paper={sheet.paper}
        students={sheet.students}
        initialAttempt={attempt}
        canEnter={permissions.includes('results.enter')}
        mechanism={sheet.mechanism}
        subcategories={sheet.subcategories}
        colorCodingEnabled={sheet.colorCodingEnabled}
      />
    </div>
  );
}
