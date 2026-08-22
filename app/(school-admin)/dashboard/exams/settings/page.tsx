import type { Metadata } from 'next';
import Link from 'next/link';

import { ExamSettingsEditor } from '@/components/exams/ExamSettingsEditor';
import { PageHeader } from '@/components/ui/PageHeader';
import { getExamSettings, listResultSubcategories } from '@/lib/exam-queries';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Exam settings',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Result sub-categories and the two exam-wide switches.
 *
 * Archived descriptors are fetched too: this is the one screen where they are
 * meant to be visible, because it is the only place a school can bring one
 * back. Every picker elsewhere takes the default and offers only what is
 * current.
 */
export default async function ExamSettingsPage() {
  const { locationId, permissions } = await requireSchoolPermission('exams.read');

  const [subcategories, settings] = await Promise.all([
    listResultSubcategories(locationId, { includeArchived: true }),
    getExamSettings(locationId),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Exam settings"
        description="What a school says instead of a mark, and how it is shown."
        actions={
          <Link
            href="/dashboard/exams"
            className="text-sm font-medium text-brand-primary hover:underline"
          >
            Back to exams
          </Link>
        }
      />

      <ExamSettingsEditor
        subcategories={subcategories}
        settings={settings}
        canWrite={permissions.includes('exams.write')}
      />
    </div>
  );
}
