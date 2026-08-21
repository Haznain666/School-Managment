import Link from 'next/link';
import type { ReactNode } from 'react';

import { Card } from '@/components/ui/Card';
import { getModuleFlags } from '@/lib/school-queries';
import { requireSchoolPermission } from '@/lib/school-guard';

/**
 * Module gate for every Accounting screen (Sprint 13.5).
 *
 * The same shape as the Fees gate beside it, and for the same reason: the
 * sidebar hides these links when the module is off, but a link is not a
 * permission — a bookmark or a typed URL would otherwise walk straight in. The
 * check lives in a layout so that adding a page later cannot forget it.
 *
 * ── The flag is `accounts`, not `accounting` ─────────────────────────────
 * `lib/platform-modules.ts` has carried "Accounts & Finance" as `accounts`
 * since Sprint 2. `SPRINTS.md` §0.9 names a new `accounting` flag; adding one
 * would mean two switches for one thing plus a `school_modules` CHECK change,
 * and a school with the old flag on and the new one off would watch the module
 * disappear on deploy.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function AccountingLayout({ children }: { children: ReactNode }) {
  const { locationId } = await requireSchoolPermission('accounting.read');
  const moduleFlags = await getModuleFlags(locationId);

  if (!moduleFlags.accounts) {
    return (
      <Card>
        <h2 className="text-lg font-semibold text-ink">
          Accounts &amp; Finance is not enabled
        </h2>
        <p className="mt-2 text-sm text-ink-muted">
          This school does not currently have the Accounts &amp; Finance module
          switched on, so its ledger, expenses and financial statements are not
          available. Contact the platform administrator to enable it.
        </p>
        <Link
          href="/dashboard"
          className="mt-4 inline-block text-sm font-medium text-brand-primary hover:underline"
        >
          Back to dashboard
        </Link>
      </Card>
    );
  }

  return <>{children}</>;
}
