import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ChannelToggleList } from '@/components/super-admin/ChannelToggleList';
import { ModuleToggleGrid } from '@/components/super-admin/ModuleToggleGrid';
import { isUuid } from '@/lib/validation';

export const metadata: Metadata = {
  title: 'Modules & channels',
};

export const dynamic = 'force-dynamic';

export default async function SchoolModulesPage({
  params,
}: {
  params: Promise<{ schoolId: string }>;
}) {
  const { schoolId } = await params;
  if (!isUuid(schoolId)) notFound();

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-ink">Modules</h3>
        <p className="mt-1 text-sm text-ink-muted">
          Switch functionality on per school. A disabled module is hidden from
          the portal navigation and refused at the API. To change several
          schools at once, use{' '}
          <Link
            href="/super-admin/modules"
            className="font-medium text-brand-primary hover:underline"
          >
            Modules across schools
          </Link>
          .
        </p>
      </div>

      <ModuleToggleGrid schoolId={schoolId} />

      <div className="pt-4">
        <h3 className="text-lg font-semibold text-ink">Channels</h3>
        <p className="mt-1 mb-4 text-sm text-ink-muted">
          How this school’s messages reach people. Email always works; WhatsApp
          is a paid add-on that rides the school’s own GoHighLevel connection.
        </p>

        <ChannelToggleList schoolId={schoolId} />
      </div>
    </div>
  );
}
