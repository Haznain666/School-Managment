import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { IntegrationsPanel } from '@/components/super-admin/IntegrationsPanel';
import { isUuid } from '@/lib/validation';

export const metadata: Metadata = {
  title: 'Integrations',
};

export const dynamic = 'force-dynamic';

export default async function SchoolIntegrationsPage({
  params,
}: {
  params: Promise<{ schoolId: string }>;
}) {
  const { schoolId } = await params;
  if (!isUuid(schoolId)) notFound();

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-ink">Integrations</h3>
        <p className="mt-1 text-sm text-ink-muted">
          Third-party accounts this school is connected to. All optional — a
          school runs fully without any of them. To switch modules or channels
          for several schools at once, use{' '}
          <Link
            href="/super-admin/modules"
            className="font-medium text-brand-primary hover:underline"
          >
            Modules across schools
          </Link>
          .
        </p>
      </div>

      <IntegrationsPanel schoolId={schoolId} />
    </div>
  );
}
