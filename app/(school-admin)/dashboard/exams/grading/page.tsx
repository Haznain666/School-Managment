import type { Metadata } from 'next';
import Link from 'next/link';

import { GradingSchemeEditor } from '@/components/exams/GradingSchemeEditor';
import { listGradingSchemes } from '@/lib/exam-queries';
import { requireSchoolPermission } from '@/lib/school-guard';

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
      <div>
        <Link
          href="/dashboard/exams"
          className="text-sm font-medium text-brand-primary hover:underline"
        >
          ← Exams
        </Link>
        <h2 className="mt-1 text-xl font-semibold text-slate-900">
          Grading schemes
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          What a percentage is worth at this school. Every school grades
          differently, so none of this is built in.
        </p>
      </div>

      <GradingSchemeEditor
        schemes={schemes}
        canWrite={permissions.includes('exams.write')}
      />
    </div>
  );
}
