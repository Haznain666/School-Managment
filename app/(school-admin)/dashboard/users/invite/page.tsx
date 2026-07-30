import type { Metadata } from 'next';

import { InviteForm } from '@/components/school/InviteForm';
import { requireSchoolRole } from '@/lib/school-guard';
import { listBranchOptions } from '@/lib/school-queries';
import { USER_MANAGEMENT_ROLES } from '@/types/school-auth';

export const metadata: Metadata = {
  title: 'Invite staff',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function InviteStaffPage() {
  const { locationId } = await requireSchoolRole(USER_MANAGEMENT_ROLES);
  const branches = await listBranchOptions(locationId);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Invite staff</h2>
        <p className="mt-1 text-sm text-slate-500">
          The invitation goes out over WhatsApp, with email as a fallback. The
          link is valid for 72 hours.
        </p>
      </div>

      <InviteForm branches={branches} />
    </div>
  );
}
