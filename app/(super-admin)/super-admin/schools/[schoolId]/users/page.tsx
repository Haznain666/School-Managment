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
 * Three ways in, in descending order of ordinariness: the person signs in with
 * their email and password; "Send sign-in email" tells someone who has never
 * signed in where to start; and a manually issued single-use link covers the
 * case where email itself is not reaching them.
 *
 * (It used to read "WhatsApp passcode first, email passcode if that fails".
 * Neither is a login mechanism any more — see STATE.md §5d.)
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
          Everyone with portal access at this school. Sign-in is by email, so
          &ldquo;Send sign-in email&rdquo; is how someone who has never signed
          in gets started. Emergency links are the last resort, for when email
          itself is not reaching them.
        </p>
      </div>

      <SchoolUsersTable schoolId={schoolId} />
    </div>
  );
}
