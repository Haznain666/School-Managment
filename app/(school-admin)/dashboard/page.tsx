import type { Metadata } from 'next';
import Link from 'next/link';

import { Card, CardTitle } from '@/components/ui/Card';
import { getMonthlyCollection } from '@/lib/fee-queries';
import { formatPkr } from '@/lib/money';
import { PLATFORM_MODULES } from '@/lib/platform-modules';
import { requireSchoolRole } from '@/lib/school-guard';
import { getDashboardCounts, getModuleFlags } from '@/lib/school-queries';
import { ADMIN_PORTAL_ROLES, USER_MANAGEMENT_ROLES } from '@/types/school-auth';

export const metadata: Metadata = {
  title: 'Dashboard',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function StatCard({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-3xl font-bold text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </Card>
  );
}

function ActionTile({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-card border border-slate-200 bg-white p-4 shadow-card transition hover:border-brand-primary"
    >
      <p className="font-medium text-slate-900">{title}</p>
      <p className="mt-1 text-sm text-slate-500">{description}</p>
    </Link>
  );
}

/**
 * Administrative overview.
 *
 * Every count is scoped to the caller's own school — the location id comes
 * from their verified session, so there is no request parameter that could
 * widen it to another tenant.
 */
export default async function SchoolDashboardPage() {
  const { claims, locationId } = await requireSchoolRole(ADMIN_PORTAL_ROLES);

  const [counts, moduleFlags] = await Promise.all([
    getDashboardCounts(locationId),
    getModuleFlags(locationId),
  ]);

  // Only queried when the school bills through the platform — a school without
  // the module would otherwise get two cards permanently reading zero.
  const collection = moduleFlags.fee_management
    ? await getMonthlyCollection(locationId)
    : null;

  const canInvite = USER_MANAGEMENT_ROLES.includes(claims.role);
  const enabledModules = PLATFORM_MODULES.filter((entry) => moduleFlags[entry.key]);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total Students"
          value={counts.students}
          hint={
            counts.activeYearName === null
              ? 'No active academic year'
              : `Enrolled in ${counts.activeYearName}`
          }
        />
        <StatCard label="Total Staff" value={counts.staff} hint="Teachers and administration" />
        <StatCard label="Active Branches" value={counts.branches} hint="Campuses in use" />
        <StatCard label="Enabled Modules" value={counts.modules} hint="Features switched on" />
      </div>

      {collection === null ? null : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Fees collected this month
            </p>
            <p className="mt-2 text-3xl font-bold text-slate-900">
              PKR {formatPkr(collection.collectedPaise)}
            </p>
            <p className="mt-1 text-xs text-slate-500">Payments recorded this month</p>
          </Card>

          <Card>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Outstanding this month
            </p>
            <p className="mt-2 text-3xl font-bold text-slate-900">
              PKR {formatPkr(collection.outstandingPaise)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Billed this month, not yet paid
            </p>
          </Card>
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Quick actions
        </h2>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {canInvite ? (
            <ActionTile
              href="/dashboard/users/invite"
              title="Invite Staff"
              description="Send a WhatsApp invitation to a new team member."
            />
          ) : null}

          {claims.role === 'school_admin' ? (
            <ActionTile
              href="/dashboard/settings"
              title="School Settings"
              description="Review your school profile and branding."
            />
          ) : null}

          {enabledModules.map((entry) => (
            <ActionTile
              key={entry.key}
              // Admissions is the first module with screens of its own; the
              // rest still land back here until their sprint builds them.
              href={entry.key === 'admissions' ? '/dashboard/admissions' : '/dashboard'}
              title={entry.label}
              description={
                entry.key === 'admissions'
                  ? 'Enrol students, review applications and set up your academic year.'
                  : `Phase ${entry.phase} module — screens arrive in a later sprint.`
              }
            />
          ))}
        </div>
      </section>

      <Card header={<CardTitle title="Recent activity" />}>
        <p className="text-sm text-slate-500">Activity feed coming soon.</p>
      </Card>
    </div>
  );
}
