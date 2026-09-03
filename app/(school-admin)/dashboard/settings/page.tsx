import { eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';

import { schools } from '@/db/schema';
import { SchoolBrandingForm } from '@/components/school/SchoolBrandingForm';
import { SchoolProfileForm } from '@/components/school/SchoolProfileForm';
import { SharedPrincipalGradesToggle } from '@/components/school/SharedPrincipalGradesToggle';
import { Card, CardTitle } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { db } from '@/lib/drizzle';
import { requireSchoolPermission } from '@/lib/school-guard';

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
      // Sprint 20, decision D4. Printed on the fee voucher, and only when set.
      ntn: schools.ntn,
      website: schools.website,
      financeEmail: schools.financeEmail,
      // Sprint 23, item 2. The rule lives in Settings; the assignments it
      // governs live on each campus's own page.
      allowSharedPrincipalGrades: schools.allowSharedPrincipalGrades,
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
          ntn: school.ntn,
          website: school.website,
          financeEmail: school.financeEmail,
        }}
        canEdit={canEdit}
      />

      <SchoolBrandingForm schoolName={school.name} canEdit={canEdit} />

      {/*
        Sprint 20, item 10 and decision D2. Its own screen rather than a card
        here, because a school holds several accounts and each of them has
        eleven fields, an on/off state and a print order.

        Gated on `settings.read` like the rest of this page — no new permission
        key, and therefore no change to the `role_permissions` CHECK (§5o).
      */}
      <Card header={<CardTitle title="Bank accounts" />}>
        <p className="text-sm text-ink-muted">
          Where fees are paid in and salaries are paid out. Every active
          student-facing account prints on your fee vouchers; the payroll one
          never does.
        </p>
        <Link
          href="/dashboard/settings/banks"
          className="mt-3 inline-block text-sm font-medium text-brand-primary hover:underline"
        >
          Manage bank accounts
        </Link>
      </Card>

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

      {/*
        The principal card left this page in Sprint 19a (item 10).

        "Who runs this campus" is a question about a campus, and it was being
        asked on a page about the school's logo and postal address — where the
        campus had to be chosen from a dropdown before the question could even be
        read. It is now on each campus's own page, which is where somebody stands
        when they ask it. The component was not deleted and `principals.manage`
        keeps its meaning and its default grants.

        The pointer stays, because a school administrator who knew where the card
        used to be will look here first.
      */}
      {permissions.includes('principals.manage') ? (
        <Card header={<CardTitle title="Principals" />}>
          <p className="text-sm text-ink-muted">
            Who heads each campus is set on that campus. Open a branch and the
            assignment card is on its page — along with its address, its code and
            everything else printed on the vouchers it issues.
          </p>
          <Link
            href="/dashboard/branches"
            className="mt-3 inline-block text-sm font-medium text-brand-primary hover:underline"
          >
            Branches
          </Link>

          {/*
            Sprint 23, item 2. The one thing about principals that *is* a
            school-wide rule rather than a campus's arrangement, so it is the
            one thing that stayed behind when the assignment card moved to the
            branch page in Sprint 19a.
          */}
          <SharedPrincipalGradesToggle
            initial={school.allowSharedPrincipalGrades}
            canEdit={canEdit}
          />
        </Card>
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
