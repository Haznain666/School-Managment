import type { Metadata } from 'next';
import Link from 'next/link';

import { BarChart } from '@/components/charts/BarChart';
import { DonutChart } from '@/components/charts/DonutChart';
import { LineChart } from '@/components/charts/LineChart';
import { Card, CardTitle } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatTile, StatTileGrid } from '@/components/ui/StatTile';
import { getActiveAcademicYear } from '@/lib/admissions-queries';
import {
  getAgingBuckets,
  getCollectionTrend,
  getFeeStatusSplit,
} from '@/lib/dashboard-queries';
import { getFeeOverview } from '@/lib/fee-queries';
import { formatPkr } from '@/lib/money';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Fees',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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
      className="block rounded-card border border-line bg-surface-raised p-4 shadow-card transition hover:border-brand-primary"
    >
      <p className="font-medium text-ink">{title}</p>
      <p className="mt-1 text-sm text-ink-muted">{description}</p>
    </Link>
  );
}

const MONTH_LABEL = new Intl.DateTimeFormat('en-GB', {
  month: 'long',
  year: 'numeric',
});

/**
 * Fee overview.
 *
 * Every figure is scoped to the caller's own school — the location id comes
 * from their verified session, so there is no request parameter that could
 * widen it to another tenant.
 */
export default async function FeesOverviewPage() {
  const { locationId, permissions } = await requireSchoolPermission('fees.read');

  const [overview, activeYear, split, aging, trend] = await Promise.all([
    getFeeOverview(locationId),
    getActiveAcademicYear(locationId),
    getFeeStatusSplit(locationId),
    getAgingBuckets(locationId),
    getCollectionTrend(locationId),
  ]);

  const thisMonth = MONTH_LABEL.format(new Date());
  const canWrite = permissions.includes('fees.write');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fee Management"
        description={`Vouchers, collections and what is still owed — for ${thisMonth}.`}
      />

      {!overview.hasFeeTypes ? (
        <Card>
          <h3 className="text-base font-semibold text-ink">Setup required</h3>
          <p className="mt-1 text-sm text-ink-muted">
            No fee heads exist yet, so nothing can be priced or billed. Start by
            seeding the standard set — tuition, admission, annual charges, library
            and examination — then set what each grade pays.
          </p>
          <Link
            href="/dashboard/fees/types"
            className="mt-4 inline-block text-sm font-medium text-brand-primary hover:underline"
          >
            Set up fee types
          </Link>
        </Card>
      ) : null}

      {activeYear === null ? (
        <Card>
          <h3 className="text-base font-semibold text-ink">
            No active academic year
          </h3>
          <p className="mt-1 text-sm text-ink-muted">
            Fees are priced per academic year, so nothing can be billed until one
            is set as active.
          </p>
          <Link
            href="/dashboard/admissions/academic-years"
            className="mt-4 inline-block text-sm font-medium text-brand-primary hover:underline"
          >
            Manage academic years
          </Link>
        </Card>
      ) : null}

      <StatTileGrid>
        <StatTile
          label="Collected this month"
          value={formatPkr(overview.collectedThisMonth)}
          detail={`Payments received in ${thisMonth}`}
        />
        <StatTile
          label="Outstanding this month"
          value={formatPkr(overview.outstandingThisMonth)}
          detail={`Still owed on ${thisMonth} vouchers`}
        />
        <StatTile
          label="Overdue vouchers"
          value={overview.overdueCount.toLocaleString()}
          detail="Past their due date and unsettled"
        />
        <StatTile
          label="Students with concessions"
          value={overview.studentsWithConcessions.toLocaleString()}
          detail="Holding a discount in force today"
        />
      </StatTileGrid>

      <div className="grid gap-5 lg:grid-cols-2">
        {split === null || split.collected + split.outstanding + split.overdue === 0 ? null : (
          <Card
            header={
              <CardTitle
                title="This year's billing"
                description={`Everything raised for ${activeYear?.name ?? 'the active year'}`}
              />
            }
          >
            <DonutChart
              title="Billing status for the year"
              summary={`Of everything billed this year, ${formatPkr(split.collected)} is collected, ${formatPkr(split.outstanding)} is not yet due and ${formatPkr(split.overdue)} is overdue.`}
              centerValue={`${Math.round(
                (100 * split.collected) /
                  Math.max(1, split.collected + split.outstanding + split.overdue),
              )}%`}
              centerLabel="collected"
              /*
                The three slices do not overlap and sum to everything billed —
                see `getFeeStatusSplit`. A donut whose parts double-count adds
                up to more than the whole it claims to divide.
              */
              slices={[
                { label: 'Collected', value: split.collected, fillClass: 'fill-status-success' },
                { label: 'Not yet due', value: split.outstanding, fillClass: 'fill-status-warning' },
                { label: 'Overdue', value: split.overdue, fillClass: 'fill-status-danger' },
              ]}
              format={formatPkr}
            />
          </Card>
        )}

        {aging.every((bucket) => bucket.value === 0) ? null : (
          <Card
            header={
              <CardTitle
                title="Outstanding by age"
                description="How long the unpaid balance has been unpaid"
              />
            }
          >
            <BarChart
              title="Outstanding balance by age"
              summary={`${formatPkr(aging.reduce((sum, b) => sum + b.value, 0))} outstanding in total, of which ${formatPkr(aging[aging.length - 1]?.value ?? 0)} is more than 90 days overdue.`}
              categories={aging.map((bucket) => bucket.label)}
              series={[{ label: 'Outstanding', values: aging.map((bucket) => bucket.value) }]}
            />
          </Card>
        )}
      </div>

      {trend.every((point) => point.value === 0) ? null : (
        <Card
          header={
            <CardTitle title="Collection by month" description="Payments received, last 12 months" />
          }
        >
          <LineChart
            title="Fee collection by month"
            summary={`Collections over the last ${trend.length} months, from ${formatPkr(trend[0]?.value ?? 0)} to ${formatPkr(trend[trend.length - 1]?.value ?? 0)}.`}
            categories={trend.map((point) => point.label)}
            series={[{ label: 'Collected', values: trend.map((point) => point.value) }]}
            area
          />
        </Card>
      )}

      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
          Quick actions
        </h3>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {canWrite ? (
            <ActionTile
              href="/dashboard/fees/challans/generate"
              title="Generate vouchers"
              description="Raise this month's bills for a student or a whole grade."
            />
          ) : null}
          <ActionTile
            href="/dashboard/fees/challans?status=unpaid"
            title="Record a payment"
            description="Find an unpaid voucher and mark what was received."
          />
          <ActionTile
            href="/dashboard/fees/reports"
            title="Defaulters"
            description="Who is overdue, and by how long."
          />
          <ActionTile
            href="/dashboard/fees/structures"
            title="Fee structure"
            description="What each grade pays under each head, per year."
          />
        </div>
      </section>

      <Card
        header={
          <CardTitle
            title="Where to start"
            description="The order these screens are meant to be used in."
          />
        }
      >
        <ol className="space-y-3 text-sm text-ink-muted">
          <li>
            <span className="font-medium text-ink">1. Fee types</span> — the
            heads you bill under, and whether each is monthly, one-off or annual.
          </li>
          <li>
            <span className="font-medium text-ink">2. Fee structure</span> —
            what every grade pays under every head, for this academic year.
          </li>
          <li>
            <span className="font-medium text-ink">3. Concessions</span> —
            sibling, staff and hardship discounts, per student.
          </li>
          <li>
            <span className="font-medium text-ink">4. Vouchers</span> —
            generate monthly bills, print them, and record what comes in.
          </li>
        </ol>
      </Card>
    </div>
  );
}
