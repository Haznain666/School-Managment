import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { SchoolUsersTable } from '@/components/super-admin/SchoolUsersTable';
import { isUuid } from '@/lib/validation';

export const metadata: Metadata = {
  title: 'School users',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Platform view of a school's members, and where emergency access is issued.
 *
 * This is the last resort in a three-layer login story: WhatsApp passcode
 * first, email passcode if that fails, and a manually issued single-use link
 * if both are down.
 */
export default async function SchoolUsersPage({
  params,
}: {
  params: Promise<{ schoolId: string }>;
}) {
  const { schoolId } = await params;
  if (!isUuid(schoolId)) notFound();

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-slate-900">Users</h3>
        <p className="mt-1 text-sm text-slate-500">
          Everyone with portal access at this school. Emergency links are for
          when a user cannot receive their passcode by WhatsApp or email.
        </p>
      </div>

      <SchoolUsersTable schoolId={schoolId} />
    </div>
  );
}
