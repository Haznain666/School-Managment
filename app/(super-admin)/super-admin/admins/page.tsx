import type { Metadata } from 'next';

import { SuperAdminsManager } from '@/components/super-admin/SuperAdminsManager';
import { PageHeader } from '@/components/ui/PageHeader';
import { listSuperAdmins, superAdminTableState } from '@/lib/super-admin-accounts';
import { requireSuperAdminPage } from '@/lib/super-admin-guard';
import { superAdminCan } from '@/lib/super-admin-permissions';

export const metadata: Metadata = {
  title: 'Super admins',
};

export const dynamic = 'force-dynamic';

/**
 * `/super-admin/admins` — who operates the platform. Sprint 35, §9.
 *
 * When the table is empty or unreachable the owner is signed in on the
 * environment credential; the page says so instead of drawing an empty list
 * with an "Add" button that the owner's own row would have to precede.
 */
export default async function SuperAdminsPage() {
  const actor = await requireSuperAdminPage('super_admins');
  const state = await superAdminTableState();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Super admins"
        description="Everyone who can sign in to this panel. The owner holds everything and cannot be removed; only the owner sets what the others may do."
      />

      {state === 'rows' ? (
        <SuperAdminsManager
          initial={await listSuperAdmins()}
          viewer={{ adminId: actor.adminId, isOwner: actor.isOwner }}
          can={{
            create: superAdminCan(actor, 'super_admins', 'c'),
            edit: superAdminCan(actor, 'super_admins', 'u'),
            delete: superAdminCan(actor, 'super_admins', 'd'),
          }}
        />
      ) : (
        <p className="rounded-lg bg-status-warning-subtle px-3 py-2 text-sm text-status-warning-ink">
          The super admin table {state === 'empty' ? 'is empty' : 'cannot be read'}, so you are signed
          in with the environment credential. Run <span className="font-mono">scripts/apply-0052.mjs</span>{' '}
          to create the owner’s account; other admins can be added after that.
        </p>
      )}
    </div>
  );
}
