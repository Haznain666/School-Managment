import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Banknote,
  ClipboardCheck,
  GraduationCap,
  Receipt,
  TrendingUp,
  Users,
} from 'lucide-react';

import { BarChart } from '@/components/charts/BarChart';
import { LineChart } from '@/components/charts/LineChart';
import { Sparkline } from '@/components/charts/Sparkline';
import { Card, CardTitle } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatTile, StatTileGrid } from '@/components/ui/StatTile';
import {
  getAttendanceTrend,
  getClassStrength,
  getCollectionTrend,
  getTodaySnapshot,
} from '@/lib/dashboard-queries';
import { getFeeOverview } from '@/lib/fee-queries';
import { formatPkr } from '@/lib/money';
import { PLATFORM_MODULES } from '@/lib/platform-modules';
import { requireSchoolRole } from '@/lib/school-guard';
import { permissionsForRole } from '@/lib/permission-queries';
import { getDashboardCounts, getModuleFlags } from '@/lib/school-queries';
import { ADMIN_PORTAL_ROLES } from '@/types/school-auth';

export const metadata: Metadata = {
  title: 'Dashboard',
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
 *
 * ── What is charted, and what is deliberately not ────────────────────────
 * Collections, attendance and class strength are charted because all three
 * come from tables this product already writes to and a head teacher reads
 * them as trends rather than as numbers.
 *
 * **Income, expenditure and profit are not charted, and must not be.** They
 * need the accounting ledger from Sprint 13.5, which does not exist. A tile
 * showing `PKR 0` for a school that collected three lakh this morning is
 * confidently wrong with no way for the reader to tell, so those tiles use
 * `StatTile`'s `unavailable` state and say what they are waiting for.
 */
export default async function SchoolDashboardPage() {
  const { claims, locationId } = await requireSchoolRole(ADMIN_PORTAL_ROLES);

  const [counts, moduleFlags, permissions] = await Promise.all([
    getDashboardCounts(locationId),
    getModuleFlags(locationId),
    permissionsForRole(locationId, claims.role),
  ]);

  const canInvite = permissions.includes('users.write');
  const enabledModules = PLATFORM_MODULES.filter((entry) => moduleFlags[entry.key]);

  // Each block of reads is gated on the module being on *and* the caller
  // holding the read permission, so a school without Fee Management never pays
  // for the fee aggregates and an accountant without `academics.read` never
  // pays for the attendance ones.
  const showFees = moduleFlags.fee_management && permissions.includes('fees.read');
  // `academics.read`, not an attendance-specific key: there isn't one, and it
  // is what `dashboard/academics/attendance/reports` is gated on, so a link
  // here can never lead somewhere the guard would bounce.
  const showAttendance = moduleFlags.academics && permissions.includes('academics.read');
  const showEnrolment = moduleFlags.admissions && permissions.includes('admissions.read');

  const [fees, collectionTrend, today, attendanceTrend, classStrength] = await Promise.all([
    showFees ? getFeeOverview(locationId) : null,
    showFees ? getCollectionTrend(locationId) : null,
    getTodaySnapshot(locationId),
    showAttendance ? getAttendanceTrend(locationId) : null,
    showEnrolment ? getClassStrength(locationId) : null,
  ]);

  const totalStrength = classStrength?.reduce((sum, row) => sum + row.value, 0) ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={
          counts.activeYearName === null
            ? 'No academic year is active yet — set one to start enrolling.'
            : `An overview of ${counts.activeYearName}.`
        }
      />

      <StatTileGrid>
        <StatTile
          label="Students"
          value={counts.students.toLocaleString()}
          icon={GraduationCap}
          detail={
            counts.activeYearName === null
              ? 'No active academic year'
              : `Enrolled in ${counts.activeYearName}`
          }
        />

        <StatTile
          label="Staff"
          value={counts.staff.toLocaleString()}
          icon={Users}
          detail="Teachers and administration"
        />

        {showFees ? (
          <StatTile
            label="Collected today"
            value={formatPkr(today.collectedToday)}
            icon={Banknote}
            detail="Payments received today"
            visual={
              collectionTrend === null ? undefined : (
                <Sparkline
                  values={collectionTrend.map((point) => point.value)}
                  label={`Collections over the last ${collectionTrend.length} months`}
                />
              )
            }
          />
        ) : null}

        {showAttendance ? (
          <StatTile
            label="Attendance today"
            icon={ClipboardCheck}
            // `null` means no register has been taken yet, which at 8am is a
            // different statement from 0% and must not be drawn as one.
            value={
              today.attendanceRateToday === null ? undefined : `${today.attendanceRateToday}%`
            }
            unavailable={
              today.attendanceRateToday === null
                ? 'No register taken yet today.'
                : undefined
            }
            detail="Present or late, of everyone marked"
          />
        ) : null}

        {showFees && fees !== null ? (
          <StatTile
            label="Outstanding this month"
            value={formatPkr(fees.outstandingThisMonth)}
            icon={Receipt}
            detail={`${fees.overdueCount.toLocaleString()} challans past due`}
          />
        ) : null}

        {/*
          The one tile that exists to say it cannot answer yet. See the
          docblock: a zero here would be a lie, and this is the screen a head
          teacher would form their impression of the product from.
        */}
        <StatTile
          label="Profit this month"
          icon={TrendingUp}
          unavailable="Needs the accounting ledger, which arrives in a later sprint."
        />
      </StatTileGrid>

      {collectionTrend !== null || attendanceTrend !== null ? (
        <div className="grid gap-5 lg:grid-cols-2">
          {collectionTrend === null ? null : (
            <Card
              header={
                <CardTitle title="Fee collection" description="Payments received per month" />
              }
            >
              <LineChart
                title="Fee collection by month"
                summary={summariseTrend(collectionTrend, (value) => formatPkr(value))}
                categories={collectionTrend.map((point) => point.label)}
                series={[
                  { label: 'Collected', values: collectionTrend.map((point) => point.value) },
                ]}
                area
              />
            </Card>
          )}

          {attendanceTrend === null ? null : (
            <Card
              header={
                <CardTitle title="Attendance" description="Monthly rate across the school" />
              }
            >
              <LineChart
                title="Attendance rate by month"
                summary={summariseTrend(attendanceTrend, (value) => `${value}%`)}
                categories={attendanceTrend.map((point) => point.label)}
                series={[
                  { label: 'Attendance', values: attendanceTrend.map((point) => point.value) },
                ]}
                format={(value) => `${Math.round(value)}%`}
              />
            </Card>
          )}
        </div>
      ) : null}

      {classStrength !== null && classStrength.length > 0 ? (
        <Card
          header={
            <CardTitle
              title="Class strength"
              description={`${totalStrength.toLocaleString()} students across ${classStrength.length} classes`}
            />
          }
        >
          <BarChart
            title="Students per class"
            summary={`${totalStrength} students across ${classStrength.length} classes, from ${Math.min(...classStrength.map((row) => row.value))} to ${Math.max(...classStrength.map((row) => row.value))} per class.`}
            categories={classStrength.map((row) => row.label)}
            series={[{ label: 'Students', values: classStrength.map((row) => row.value) }]}
            format={(value) => String(Math.round(value))}
          />
        </Card>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
          Quick actions
        </h2>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {canInvite ? (
            <ActionTile
              href="/dashboard/users/invite"
              title="Invite Staff"
              description="Send an email invitation to a new team member."
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
    </div>
  );
}

/**
 * The one-sentence summary a screen reader hears instead of the chart.
 *
 * Built from the data rather than written by hand so it cannot go stale, and
 * phrased as a direction plus two endpoints — which is what someone glancing at
 * a line chart actually takes from it.
 */
function summariseTrend(
  points: ReadonlyArray<{ label: string; value: number }>,
  format: (value: number) => string,
): string {
  if (points.length === 0) return 'No data yet.';

  const first = points[0]!;
  const last = points[points.length - 1]!;
  const direction =
    last.value > first.value ? 'rising' : last.value < first.value ? 'falling' : 'flat';

  const peak = points.reduce((best, point) => (point.value > best.value ? point : best), first);

  return `${direction} from ${format(first.value)} in ${first.label} to ${format(last.value)} in ${last.label}, peaking at ${format(peak.value)} in ${peak.label}.`;
}
