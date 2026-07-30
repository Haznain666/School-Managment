import type { Metadata } from 'next';

import { SchoolsTable } from '@/app/(super-admin)/super-admin/SchoolsTable';

export const metadata: Metadata = {
  title: 'Super Admin',
};

/**
 * Super Admin home — scaffold only (Sprint 1).
 *
 * Lists the tenant directory so a platform admin can confirm provisioning
 * worked. Tenant CRUD, GHL connection status and billing come later.
 *
 * NOTE ON THE ROUTE: the agreed layout put this page at `(super-admin)/page.tsx`,
 * which would resolve to `/` and collide with the public landing page. It lives
 * at `/super-admin` instead, inside the same route group.
 */
export default function SuperAdminPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Schools</h2>
        <p className="mt-1 text-sm text-slate-500">
          Every tenant on the platform, keyed by GHL Location ID.
        </p>
      </div>

      <SchoolsTable />
    </div>
  );
}
