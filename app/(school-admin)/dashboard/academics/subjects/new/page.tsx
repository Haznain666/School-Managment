import type { Metadata } from 'next';

import { SubjectForm } from '@/components/academics/SubjectForm';
import { PageHeader } from '@/components/ui/PageHeader';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'New subject',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function NewSubjectPage() {
  await requireSchoolPermission('academics.write');

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="New subject"
        description="Subjects belong to the school rather than to a grade — the same Mathematics is taught in Class 1 and Class 10."
      />

      <SubjectForm />
    </div>
  );
}
