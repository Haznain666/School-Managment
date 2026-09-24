import type { Metadata } from 'next';

import { ChangeOwnPasswordForm } from '@/components/super-admin/ChangeOwnPasswordForm';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { requireSuperAdminPage } from '@/lib/super-admin-guard';
import {
  SUPER_ADMIN_AREA_LABELS,
  SUPER_ADMIN_AREAS,
} from '@/lib/super-admin-permissions';

export const metadata: Metadata = {
  title: 'My account',
};

export const dynamic = 'force-dynamic';

/** `/super-admin/account` — who you are here, and your own password. §9. */
export default async function MyAccountPage() {
  const actor = await requireSuperAdminPage();

  const areas = SUPER_ADMIN_AREAS.filter((area) => actor.permissions[area].r).map(
    (area) => SUPER_ADMIN_AREA_LABELS[area],
  );

  return (
    <div className="space-y-6">
      <PageHeader title="My account" description={actor.email} />

      <Card>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-ink-muted">Name</dt>
            <dd className="text-ink">{actor.name}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">Access</dt>
            <dd className="text-ink">
              {actor.isOwner ? 'Platform owner — everything' : areas.length === 0 ? 'Nothing yet' : areas.join(', ')}
            </dd>
          </div>
        </dl>
      </Card>

      <ChangeOwnPasswordForm
        disabledReason={
          actor.adminId === null
            ? 'You are signed in with the environment credential. Change that password in the host’s environment, or run scripts/apply-0052.mjs so your account moves into the super admin table.'
            : null
        }
      />
    </div>
  );
}
