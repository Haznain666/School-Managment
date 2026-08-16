import { eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';

import { schools } from '@/db/schema';
import { PrincipalAssignments } from '@/components/school/PrincipalAssignments';
import { SchoolBrandingForm } from '@/components/school/SchoolBrandingForm';
import { SchoolProfileForm } from '@/components/school/SchoolProfileForm';
import { Card, CardTitle } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { db } from '@/lib/drizzle';
import { requireSchoolPermission } from '@/lib/school-guard';
import { listBranchOptions } from '@/lib/school-queries';

export const metadata: Metadata = {
  title: 'Settings',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * School settings — self-serve.
 *
 * Through Sprint 7 this page reported and did not edit: school details and
 * branding were the platform operator's to change, and a school wanting a new
 * logo raised a ticket. That was the wrong owner for the wrong things. Contact
 * details and branding are exactly what a school is the authority on, and
 * exactly what changes often enough for a ticket to be a poor answer.
 *
 * What did *not* move is the small set of fields that would break something
 * outside the school if it changed — the subdomain, the school code, the
 * billing state. `app/api/school/settings/route.ts` documents why.
 */
export default async function SchoolSettingsPage() {
  const { locationId, permissions } = await requireSchoolPermission('settings.read');

  const rows = await db
    .select({
      name: schools.name,
      city: schools.city,
      slug: schools.slug,
      schoolCode: schools.schoolCode,
      phone: schools.phone,
      email: schools.email,
      address: schools.address,
      principalName: schools.principalName,
    })
    .from(schools)
    .where(eq(schools.locationId, locationId))
    .limit(1);

  const school = rows[0];

  if (school === undefined) {
    return (
      <Card>
        <p className="text-sm text-ink-muted">This school could not be loaded.</p>
      </Card>
    );
  }

  const canEdit = permissions.includes('settings.write');
  const branchOptions = permissions.includes('principals.manage')
    ? await listBranchOptions(locationId)
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description={canEdit ? 'Your school profile and branding. Changes here apply to everyone at your school straight away.' : 'Your school profile and branding. Your role can see these but not change them.'}
      />

      <SchoolProfileForm
        readOnly={{
          name: school.name,
          slug: school.slug,
          city: school.city,
          schoolCode: school.schoolCode,
        }}
        initial={{
          phone: school.phone,
          email: school.email,
          address: school.address,
          principalName: school.principalName,
        }}
        canEdit={canEdit}
      />

      <SchoolBrandingForm schoolName={school.name} canEdit={canEdit} />

      {permissions.includes('permissions.manage') ? (
        <Card header={<CardTitle title="Roles and permissions" />}>
          <p className="text-sm text-ink-muted">
            Decide what each role at your school may do — who can take a payment,
            who can approve payroll, who can see a personnel file.
          </p>
          <Link
            href="/dashboard/settings/permissions"
            className="mt-3 inline-block text-sm font-medium text-brand-primary hover:underline"
          >
            Manage permissions
          </Link>
        </Card>
      ) : null}

      {permissions.includes('principals.manage') ? (
        <PrincipalAssignments branches={branchOptions} canEdit />
      ) : null}

      <Card header={<CardTitle title="Notification preferences" />}>
        <p className="text-sm text-ink-muted">
          Parents choose for themselves which emails they receive, from their own
          portal. Nothing a school sends to a notice board can be switched off —
          only the email copy of it.
        </p>
      </Card>
    </div>
  );
}
