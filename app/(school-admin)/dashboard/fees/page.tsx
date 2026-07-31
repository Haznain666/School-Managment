import type { Metadata } from 'next';
import Link from 'next/link';

import { Card } from '@/components/ui/Card';
import { MONTH_NAMES } from '@/db/schema/academic-years';
import { getFeeOverview, listFeeTypes } from '@/lib/fee-queries';
import { canManageFees } from '@/lib/fee-roles';
import { formatPkrLabel } from '@/lib/money';
import { requireSchoolRole } from '@/lib/school-guard';
import { ADMIN_PORTAL_ROLES } from '@/types/school-auth';

export const metadata: Metadata = {
  title: 'Fees',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
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
 * Fee overview.
 *
 * Every figure is scoped to the caller's own school — the location id comes
 * from their verified session, so there is no request parameter that could
 * widen it to another tenant.
 */
export default async function FeesOverviewPage() {
  const { claims, locationId } = await requireSchoolRole(ADMIN_PORTAL_ROLES);

  const [overview, feeTypes] = await Promise.all([
    getFeeOverview(locationId),
    listFeeTypes(locationId),
  ]);

  const canManage = canManageFees(claims.role);
  const monthName = MONTH_NAMES[overview.currentMonth - 1] ?? '';

  return (
    <div className="space-y-6">
      {feeTypes.length === 0 ? (
        <Card>
          <h2 className="text-base font-semibold text-slate-900">
            Fee heads are not set up yet
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Nothing can be billed until this school has at least one fee head —
            tuition, admission, annual charges and so on. Seeding the defaults
            takes one click and everything stays editable afterwards.
          </p>
          <Link
            href="/dashboard/fees/types"
            className="mt-4 inline-block text-sm font-medium text-brand-primary hover:underline"
          >
            Set up fee heads
          </Link>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={`Collected in ${monthName}`}
          value={formatPkrLabel(overview.collectedThisMonthPaise)}
          hint="Payments recorded this month"
        />
        <StatCard
          label={`Outstanding for ${monthName}`}
          value={formatPkrLabel(overview.outstandingThisMonthPaise)}
          hint="Billed this month, not yet paid"
        />
        <StatCard
          label="Overdue challans"
          value={String(overview.overdueChallanCount)}
          hint="Past their due date, any month"
        />
        <StatCard
          label="Students with concessions"
          value={String(overview.activeConcessionCount)}
          hint="Holding an active discount"
        />
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Quick actions
        </h2>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {canManage ? (
            <ActionTile
              href="/dashboard/fees/challans/generate"
              title="Generate challans"
              description="Raise this month's bills for a grade or one student."
            />
          ) : null}
          <ActionTile
            href="/dashboard/fees/challans"
            title="Challans"
            description="Search the register and record payments."
          />
          <ActionTile
            href="/dashboard/fees/reports"
            title="Reports"
            description="Outstanding, collection rate and defaulters."
          />
          <ActionTile
            href="/dashboard/fees/structures"
            title="Fee structure"
            description="What each grade pays, per head, per year."
          />
        </div>
      </section>

      <Card>
        <h2 className="text-base font-semibold text-slate-900">Getting set up</h2>
        <ol className="mt-3 space-y-2 text-sm text-slate-600">
          <li>
            <strong className="text-slate-900">1.</strong>{' '}
            <Link href="/dashboard/fees/types" className="text-brand-primary hover:underline">
              Fee heads
            </Link>{' '}
            — what the school bills for. Seed the defaults, then rename to suit.
          </li>
          <li>
            <strong className="text-slate-900">2.</strong>{' '}
            <Link
              href="/dashboard/fees/structures"
              className="text-brand-primary hover:underline"
            >
              Fee structure
            </Link>{' '}
            — how much each grade pays under each head, for this academic year.
          </li>
          <li>
            <strong className="text-slate-900">3.</strong>{' '}
            <Link
              href="/dashboard/fees/settings"
              className="text-brand-primary hover:underline"
            >
              Settings
            </Link>{' '}
            — the due day, late fee policy and bank details printed on
            challans.
          </li>
          <li>
            <strong className="text-slate-900">4.</strong>{' '}
            <Link
              href="/dashboard/fees/challans/generate"
              className="text-brand-primary hover:underline"
            >
              Generate
            </Link>{' '}
            — raise the month&rsquo;s challans, by grade or one at a time.
          </li>
        </ol>
      </Card>
    </div>
  );
}
