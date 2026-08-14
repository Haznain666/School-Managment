import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { SubjectForm } from '@/components/academics/SubjectForm';
import { PageHeader } from '@/components/ui/PageHeader';
import { getSubject } from '@/lib/academics-queries';
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

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Edit subject"
        description="Renaming affects every timetable this subject appears in, past and present."
      />

      <SubjectForm subject={subject} />
    </div>
  );
}
