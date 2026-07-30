import { eq } from 'drizzle-orm';
import type { Metadata } from 'next';

import { schools } from '@/db/schema';
import { PaletteSwatches } from '@/components/super-admin/PalettePreview';
import { Card, CardTitle } from '@/components/ui/Card';
import { db } from '@/lib/drizzle';
import { requireSchoolRole } from '@/lib/school-guard';
import { getSchoolBranding } from '@/lib/school-tenant';

export const metadata: Metadata = {
  title: 'Settings',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-sm text-slate-900">
        {value === null || value === '' ? (
          <span className="text-slate-400">Not set</span>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

/**
 * School settings — read-only.
 *
 * School details and branding are owned by the platform administrator, not by
 * the school, so this page reports rather than edits. Making that explicit is
 * kinder than showing disabled inputs.
 */
export default async function SchoolSettingsPage() {
  const { locationId } = await requireSchoolRole(['school_admin', 'branch_admin']);

  const [rows, branding] = await Promise.all([
    db
      .select({
        name: schools.name,
        city: schools.city,
        slug: schools.slug,
        phone: schools.phone,
        email: schools.email,
        principalName: schools.principalName,
      })
      .from(schools)
      .where(eq(schools.locationId, locationId))
      .limit(1),
    getSchoolBranding(locationId),
  ]);

  const school = rows[0];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Settings</h2>
        <p className="mt-1 text-sm text-slate-500">
          Your school profile and branding, as configured by the platform.
        </p>
      </div>

      <Card header={<CardTitle title="School profile" />}>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Name" value={school?.name ?? null} />
          <Field label="City" value={school?.city ?? null} />
          <Field label="Subdomain" value={school?.slug ?? null} />
          <Field label="Phone" value={school?.phone ?? null} />
          <Field label="Email" value={school?.email ?? null} />
          <Field label="Principal" value={school?.principalName ?? null} />
        </dl>

        <p className="mt-4 text-xs text-slate-500">
          To update school details, contact your platform administrator.
        </p>
      </Card>

      <Card header={<CardTitle title="Active branding" />}>
        <div className="flex flex-wrap items-start gap-6">
          {branding?.logoUrl != null && branding.logoUrl !== '' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={branding.logoUrl}
              alt={`${branding.name} logo`}
              className="h-20 w-20 rounded-lg border border-slate-200 bg-white object-contain p-1"
            />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-400">
              No logo
            </div>
          )}

          <div className="min-w-[16rem] flex-1">
            {branding?.palette != null ? (
              <PaletteSwatches palette={branding.palette} />
            ) : (
              <p className="text-sm text-slate-500">No palette has been set.</p>
            )}
          </div>
        </div>

        <p className="mt-4 text-xs text-slate-500">
          To change branding, contact your platform administrator.
        </p>
      </Card>

      <Card header={<CardTitle title="Notification preferences" />}>
        <p className="text-sm text-slate-500">Coming soon.</p>
      </Card>
    </div>
  );
}
