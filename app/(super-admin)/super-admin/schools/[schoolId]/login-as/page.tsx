import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { SchoolLoginAsForm } from '@/app/(super-admin)/super-admin/schools/[schoolId]/login-as/SchoolLoginAsForm';
import { Card } from '@/components/ui/Card';
import { getSchoolById } from '@/lib/schools';

export const metadata: Metadata = {
  title: 'Sign in to school',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * "Login as Admin" — the operator's own way into a customer's portal.
 *
 * Middleware has already established that a panel session exists; this screen
 * asks for the password again before the tenant is opened. Reading a school's
 * student and fee records is a different act from administering the platform,
 * and it should take a deliberate one.
 */
export default async function SchoolLoginAsPage({
  params,
}: {
  params: Promise<{ schoolId: string }>;
}) {
  const { schoolId } = await params;
  const school = await getSchoolById(schoolId);

  if (school === null) notFound();

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <Link
          href="/super-admin/schools"
          className="text-sm font-medium text-slate-500 hover:text-slate-700"
        >
          ← Back to schools
        </Link>
        <h2 className="mt-2 text-xl font-semibold text-slate-900">
          Sign in to {school.schoolName}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Enter your Super Admin credentials to open this school&rsquo;s admin
          portal. No WhatsApp passcode is involved — that is how the
          school&rsquo;s own staff sign in, and it is unchanged.
        </p>
      </div>

      {school.isActive ? null : (
        <Card>
          <p className="text-sm text-amber-800">
            This school is deactivated, so its portal is closed to everyone
            including you. Reactivate it from the school list first.
          </p>
        </Card>
      )}

      <SchoolLoginAsForm schoolId={school.id} schoolName={school.schoolName} />

      <Card>
        <h3 className="text-sm font-semibold text-slate-900">What this does</h3>
        <ul className="mt-2 space-y-1.5 text-sm text-slate-600">
          <li>
            Opens{' '}
            <span className="font-mono text-xs">{school.slug}</span> with full
            School Administrator access.
          </li>
          <li>
            The session is recorded as the platform Super Admin, and the school
            portal says so on screen while you are in it.
          </li>
          <li>
            It grants nothing outside this one school — every query is still
            scoped to its Location ID.
          </li>
        </ul>
      </Card>
    </div>
  );
}
