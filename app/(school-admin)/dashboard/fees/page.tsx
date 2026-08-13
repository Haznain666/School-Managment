import type { Metadata } from 'next';
import Link from 'next/link';

import { Card, CardTitle } from '@/components/ui/Card';
import { getActiveAcademicYear } from '@/lib/admissions-queries';
import { getFeeOverview } from '@/lib/fee-queries';
import { formatPkr } from '@/lib/money';
import { requireSchoolPermission } from '@/lib/school-guard';

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
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
        {label}
      </p>
      <p className="mt-2 text-2xl font-bold text-ink">{value}</p>
      <p className="mt-1 text-xs text-ink-muted">{hint}</p>
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

  const [overview, activeYear] = await Promise.all([
    getFeeOverview(locationId),
    getActiveAcademicYear(locationId),
  ]);

  const thisMonth = MONTH_LABEL.format(new Date());
  const canWrite = permissions.includes('fees.write');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-ink">Fee Management</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Challans, collections and what is still owed — for {thisMonth}.
        </p>
      </div>

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

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Collected this month"
          value={formatPkr(overview.collectedThisMonth)}
          hint={`Payments received in ${thisMonth}`}
        />
        <StatCard
          label="Outstanding this month"
          value={formatPkr(overview.outstandingThisMonth)}
          hint={`Still owed on ${thisMonth} challans`}
        />
        <StatCard
          label="Overdue challans"
          value={String(overview.overdueCount)}
          hint="Past their due date and unsettled"
        />
        <StatCard
          label="Students with concessions"
          value={String(overview.studentsWithConcessions)}
          hint="Holding a discount in force today"
        />
      </div>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
          Quick actions
        </h3>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {canWrite ? (
            <ActionTile
              href="/dashboard/fees/challans/generate"
              title="Generate challans"
              description="Raise this month's bills for a student or a whole grade."
            />
          ) : null}
          <ActionTile
            href="/dashboard/fees/challans?status=unpaid"
            title="Record a payment"
            description="Find an unpaid challan and mark what was received."
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
            <span className="font-medium text-ink">4. Challans</span> —
            generate monthly bills, print them, and record what comes in.
          </li>
        </ol>
      </Card>
    </div>
  );
}
