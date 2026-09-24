import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { BillingSettingsPanel } from '@/components/super-admin/BillingSettingsPanel';
import { getSchoolBillingOverview } from '@/lib/platform-billing-queries';
import { requireSuperAdminPage } from '@/lib/super-admin-guard';
import { superAdminCan } from '@/lib/super-admin-permissions';
import { isUuid } from '@/lib/validation';

export const metadata: Metadata = {
  title: 'Billing',
};

export const dynamic = 'force-dynamic';

/**
 * `/super-admin/schools/[schoolId]/billing` — Sprint 35, §2.
 *
 * Read on the server and handed to the panel whole, so the tab paints with the
 * school's real figures in its first frame rather than a "Loading…" line; the
 * panel refetches only after it writes. An operator who may view billing but
 * not edit it sees the same screen with the inputs disabled.
 */
export default async function SchoolBillingPage({
  params,
}: {
  params: Promise<{ schoolId: string }>;
}) {
  const actor = await requireSuperAdminPage('billing');

  const { schoolId } = await params;
  if (!isUuid(schoolId)) notFound();

  const overview = await getSchoolBillingOverview(schoolId);
  if (overview === null) notFound();

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-ink">Billing</h3>
        <p className="mt-1 text-sm text-ink-muted">
          What this school pays SchoolHub each month, when it pays it, and whether it is open.
        </p>
      </div>

      <BillingSettingsPanel
        initial={overview}
        canEdit={superAdminCan(actor, 'billing', 'u')}
        canGenerate={superAdminCan(actor, 'billing', 'c')}
      />
    </div>
  );
}
