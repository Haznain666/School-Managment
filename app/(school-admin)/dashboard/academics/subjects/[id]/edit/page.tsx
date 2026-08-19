import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { SubjectForm } from '@/components/academics/SubjectForm';
import { PageHeader } from '@/components/ui/PageHeader';
import { getSubject, listSubjects } from '@/lib/academics-queries';
import { requireSchoolPermission } from '@/lib/school-guard';
import { isUuid } from '@/lib/validation';

export const metadata: Metadata = {
  title: 'Edit subject',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The id comes from the URL, so the lookup is scoped to the caller's own
 * school: a subject belonging to another tenant resolves to nothing and is
 * answered with a 404, not with somebody else's record.
 */
export default async function EditSubjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { locationId } = await requireSchoolPermission('academics.write');
  const { id } = await params;

  if (!isUuid(id)) notFound();

  const subject = await getSubject(locationId, id);
  if (subject === null) notFound();

  // This subject is excluded — a colour is not too close to itself, and the
  // warning firing on every edit would train people to ignore it.
  const existing = await listSubjects(locationId, { activeOnly: true });
  const others = existing.filter((one) => one.id !== id);

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Edit subject"
        description="Renaming affects every timetable this subject appears in, past and present."
      />

      <SubjectForm
        subject={subject}
        otherSubjects={others.map((one) => ({ name: one.name, color: one.color }))}
      />
    </div>
  );
}
