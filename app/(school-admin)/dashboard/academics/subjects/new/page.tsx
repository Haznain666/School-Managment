import type { Metadata } from 'next';

import { SubjectForm } from '@/components/academics/SubjectForm';
import { PageHeader } from '@/components/ui/PageHeader';
import { listSubjects } from '@/lib/academics-queries';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'New subject',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function NewSubjectPage() {
  const { locationId } = await requireSchoolPermission('academics.write');

  // Read here so the colour picker can warn about a shade already in use,
  // without making a request of its own once the page is open.
  const existing = await listSubjects(locationId, { activeOnly: true });

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="New subject"
        description="Subjects belong to the school rather than to a grade — the same Mathematics is taught in Class 1 and Class 10."
      />

      <SubjectForm
        otherSubjects={existing.map((one) => ({ name: one.name, color: one.color }))}
      />
    </div>
  );
}
