import type { Metadata } from 'next';
import Link from 'next/link';

import { Card, CardTitle } from '@/components/ui/Card';
import { getFeeOverview } from '@/lib/fee-queries';
import { formatPkr } from '@/lib/money';
import { PLATFORM_MODULES } from '@/lib/platform-modules';
import { requireSchoolRole } from '@/lib/school-guard';
import { getDashboardCounts, getModuleFlags } from '@/lib/school-queries';
import {
  ADMIN_PORTAL_ROLES,
  FEE_READ_ROLES,
  USER_MANAGEMENT_ROLES,
} from '@/types/school-auth';

export const metadata: Metadata = {
  title: 'Dashboard',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint: string;
}) {
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

/** Modules that have real screens. Anything absent lands back on /dashboard. */
const MODULE_HOMES: Partial<Record<string, string>> = {
  admissions: '/dashboard/admissions',
  fee_management: '/dashboard/fees',
};

const MODULE_DESCRIPTIONS: Partial<Record<string, string>> = {
  admissions: 'Enrol students, review applications and set up your academic year.',
  fee_management: 'Generate challans, record payments and chase what is overdue.',
};

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

  const canInvite = USER_MANAGEMENT_ROLES.includes(claims.role);
  const enabledModules = PLATFORM_MODULES.filter((entry) => moduleFlags[entry.key]);

  // Fee figures are read only when the module is on and the caller may see
  // them, so a school without Fee Management does not pay for the queries.
  const showFees = moduleFlags.fee_management && FEE_READ_ROLES.includes(claims.role);
  const fees = showFees ? await getFeeOverview(locationId) : null;

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

      {fees === null ? null : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Collected this month"
            value={formatPkr(fees.collectedThisMonth)}
            hint="Payments received this calendar month"
          />
          <StatCard
            label="Outstanding this month"
            value={formatPkr(fees.outstandingThisMonth)}
            hint="Still owed on this month's challans"
          />
          <StatCard
            label="Overdue challans"
            value={fees.overdueCount}
            hint="Past their due date and unsettled"
          />
          <StatCard
            label="Students with concessions"
            value={fees.studentsWithConcessions}
            hint="Holding a discount in force today"
          />
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
              // Admissions and Fees have screens of their own; the rest still
              // land back here until their sprint builds them.
              href={MODULE_HOMES[entry.key] ?? '/dashboard'}
              title={entry.label}
              description={
                MODULE_DESCRIPTIONS[entry.key] ??
                `Phase ${entry.phase} module — screens arrive in a later sprint.`
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
