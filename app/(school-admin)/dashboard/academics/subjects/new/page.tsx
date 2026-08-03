import type { Metadata } from 'next';

import { SubjectForm } from '@/components/academics/SubjectForm';
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
      <div>
        <h2 className="text-xl font-semibold text-slate-900">New subject</h2>
        <p className="mt-1 text-sm text-slate-500">
          Subjects belong to the school rather than to a grade — the same
          Mathematics is taught in Class 1 and Class 10.
        </p>
      </div>

      <SubjectForm />
    </div>
  );
}
