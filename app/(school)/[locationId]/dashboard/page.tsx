import type { Metadata } from 'next';

import { Badge } from '@/components/ui/Badge';
import { Card, CardTitle } from '@/components/ui/Card';
import { emptyModuleFlags, moduleLabel, PLATFORM_MODULE_KEYS } from '@/lib/platform-modules';
import { getSchoolByLocationId } from '@/lib/schools';

export const metadata: Metadata = {
  title: 'Dashboard',
};

export const dynamic = 'force-dynamic';

/**
 * Sprint 1 dashboard placeholder.
 *
 * It confirms the foundation works end to end — subdomain resolved, tenant
 * identified, branding applied, module flags read. The real dashboards
 * (attendance, fees, timetable) land in Sprint 2.
 */
export default async function SchoolDashboardPage({
  params,
}: {
  params: Promise<{ locationId: string }>;
}) {
  const { locationId } = await params;
  const school = await getSchoolByLocationId(locationId);

  const moduleFlags = school?.moduleFlags ?? emptyModuleFlags();

  return (
    <div className="space-y-6">
      <Card header={<CardTitle title="School" description="Tenant details" />}>
        <dl className="grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">
              School
            </dt>
            <dd className="mt-1 text-sm font-medium text-slate-900">
              {school?.schoolName ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">
              Subdomain
            </dt>
            <dd className="mt-1 text-sm font-medium text-slate-900">
              {school?.slug ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">
              GHL Location ID
            </dt>
            <dd className="mt-1 break-all font-mono text-sm text-slate-900">
              {locationId}
            </dd>
          </div>
        </dl>
      </Card>

      <Card
        header={
          <CardTitle
            title="Modules"
            description="Enabled features for this school"
          />
        }
      >
        <ul className="flex flex-wrap gap-2">
          {PLATFORM_MODULE_KEYS.map((key) => (
            <li key={key}>
              <Badge variant={moduleFlags[key] ? 'success' : 'neutral'}>
                {moduleLabel(key)}
                {moduleFlags[key] ? ' · on' : ' · off'}
              </Badge>
            </li>
          ))}
        </ul>
      </Card>

      <Card header={<CardTitle title="Next up" description="Sprint 2" />}>
        <p className="text-sm text-slate-600">
          Admissions, attendance, fee collection and timetables are not built
          yet. This page exists to prove the tenant foundation: subdomain →
          Location ID → verified claims → tenant-scoped data.
        </p>
      </Card>
    </div>
  );
}
