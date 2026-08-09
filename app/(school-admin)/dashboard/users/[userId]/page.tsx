import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { UserDetailPanel } from '@/components/school/UserDetailPanel';
import { requireSchoolPermission } from '@/lib/school-guard';
import { getSchoolUserById, listBranchOptions } from '@/lib/school-queries';
import { isUuid } from '@/lib/validation';
import { ROLE_LABELS, isUserRole } from '@/types/school-auth';

export const metadata: Metadata = {
  title: 'User profile',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  if (!isUuid(userId)) notFound();

  const { claims, locationId, permissions } =
    await requireSchoolPermission('users.read');

  const user = await getSchoolUserById(locationId, userId);
  if (user === null) notFound();

  // A branch-scoped admin may only open members of their own branch.
  if (claims.branchId !== null && user.branchId !== claims.branchId) {
    notFound();
  }

  const branches = await listBranchOptions(locationId);
  const canEdit = permissions.includes('users.write');

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link
          href="/dashboard/users"
          className="text-sm font-medium text-brand-primary hover:underline"
        >
          ← Back to users
        </Link>
        <h2 className="mt-2 text-xl font-semibold text-slate-900">{user.name}</h2>
        <p className="mt-1 text-sm text-slate-500">
          {isUserRole(user.role) ? ROLE_LABELS[user.role] : user.role}
          {user.branchName === null ? '' : ` · ${user.branchName}`}
        </p>
      </div>

      <UserDetailPanel
        canEdit={canEdit}
        branches={branches}
        user={{
          id: user.id,
          authUserId: user.authUserId,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          branchId: user.branchId,
          branchName: user.branchName,
          isActive: user.isActive,
          joinedAt: user.joinedAt === null ? null : user.joinedAt.toISOString(),
          createdAt: user.createdAt.toISOString(),
        }}
      />
    </div>
  );
}
