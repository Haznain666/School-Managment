import type { Metadata } from 'next';

import { GradingSchemeEditor } from '@/components/exams/GradingSchemeEditor';
import { listGradingSchemes } from '@/lib/exam-queries';
import { requireSchoolPermission } from '@/lib/school-guard';
import { PageHeader } from '@/components/ui/PageHeader';

export const metadata: Metadata = {
  title: 'Grading schemes',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function GradingSchemesPage() {
  const { locationId, permissions } = await requireSchoolPermission('exams.read');
  const schemes = await listGradingSchemes(locationId);

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Exams', href: '/dashboard/exams' }, { label: 'Grading schemes' }]}
        title="Grading schemes"
        description="What a percentage is worth at this school. Every school grades differently, so none of this is built in."
      />

      <GradingSchemeEditor
        schemes={schemes}
        canWrite={permissions.includes('exams.write')}
      />
    </div>
  );
}
