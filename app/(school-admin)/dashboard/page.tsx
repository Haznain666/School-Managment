import type { Metadata } from 'next';
import Link from 'next/link';
import {
  AlertTriangle,
  Banknote,
  ClipboardCheck,
  GraduationCap,
  Receipt,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';

import { BarChart } from '@/components/charts/BarChart';
import { DonutChart } from '@/components/charts/DonutChart';
import { LineChart } from '@/components/charts/LineChart';
import { Sparkline } from '@/components/charts/Sparkline';
import { SetupProgressCard } from '@/components/school/SetupProgressCard';
import { Card, CardTitle } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { QuickLinks, type QuickLink } from '@/components/ui/QuickLinks';
import { StatTile, StatTileGrid } from '@/components/ui/StatTile';
import {
  getAdmissionsFunnel,
  getAgingBuckets,
  getAttendanceAverage,
  getAttendanceByClass,
  getAttendanceTrend,
  getClassStrength,
  getCollectionComparison,
  getCollectionTrend,
  getEnrolmentComparison,
  getFeeStatusSplit,
  getOutstandingSummary,
  getRecentExamOutcomes,
  getSetupProgress,
  getTodaySnapshot,
  settle,
  type AggregateScope,
} from '@/lib/dashboard-queries';
import {
  getDashboardExceptions,
  resolveDashboardScope,
  type DashboardException,
} from '@/lib/school-dashboard';
import { getAccountingOverview } from '@/lib/accounting-queries';
import { getActiveAcademicYear } from '@/lib/admissions-queries';
import { formatPkr } from '@/lib/money';
import { PLATFORM_MODULES } from '@/lib/platform-modules';
import { describeScope, resolvePrincipalScope } from '@/lib/principal-resolver';
import { requireSchoolRole } from '@/lib/school-guard';
import { permissionsForRole } from '@/lib/permission-queries';
import { getDashboardCounts, getModuleFlags, getSchoolUserByUid } from '@/lib/school-queries';
import { ADMIN_PORTAL_ROLES } from '@/types/school-auth';

export const metadata: Metadata = {
  title: 'Dashboard',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Modules that have real screens. Anything absent lands back on /dashboard. */
const MODULE_HOMES: Partial<Record<string, string>> = {
  admissions: '/dashboard/admissions',
  fee_management: '/dashboard/fees',
};

const MODULE_DESCRIPTIONS: Partial<Record<string, string>> = {
  admissions: 'Enrol students, review applications and set up your academic year.',
  fee_management: 'Generate challans, record payments and chase what is overdue.',
};

/** Below this, an attendance bar is marked as well as measured. */
const ATTENDANCE_CONCERN = 85;

/**
 * Administrative overview.
 *
 * **Decision it informs:** where today's attention goes — money, attendance, or
 * an exception.
 *
 * Every count is scoped to the caller's own school — the location id comes from
 * their verified session, so there is no request parameter that could widen it
 * to another tenant.
 *
 * ── BR4: this screen is served to principals too ─────────────────────────
 * Every count, chart and exception passes through `resolveDashboardScope`,
 * which turns a `PrincipalScope` into the grade list the aggregates filter on.
 * `scoped: false` — every school administrator, every accountant, and every
 * school running one head — narrows nothing, so this is byte-for-byte the old
 * behaviour for them.
 *
 * The quick actions are gated on **permissions**, never on the role name. A
 * principal does not hold `settings.write`, `permissions.manage` or
 * `principals.manage`, so the three actions those guard disappear on their own;
 * gating them on `role === 'school_admin'` would have been a second list to
 * keep in step with the first, and the first is the one the routes enforce.
 *
 * ── Every headline tile carries a comparison ─────────────────────────────
 * A KPI without a benchmark is a number, not an indicator. Four of the five
 * tiles on the previous version of this screen had none: "PKR 812,000
 * collected" is a fact nobody can act on, and "14% behind this point last
 * month" is a morning's work.
 *
 * ── Nothing here renders a zero it cannot vouch for ──────────────────────
 * `settle` turns a failed read into one absent tile with a reason, never a
 * zero and never a blank page. `PKR 0` on a school that collected three lakh
 * this morning is confidently wrong and unfalsifiable by the reader.
 */

/** The calendar month containing `at`, as two `YYYY-MM-DD` strings. */
function monthOf(at: Date): { from: string; to: string } {
  const year = at.getUTCFullYear();
  const month = at.getUTCMonth();
  return {
    from: new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10),
    to: new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10),
  };
}

export default async function SchoolDashboardPage() {
  const { claims, locationId } = await requireSchoolRole(ADMIN_PORTAL_ROLES);

  // Not wrapped, deliberately: without the counts, the module flags, the
  // permission list or the scope there is no page, and an empty frame would say
  // "your school has nothing in it", which is worse than an error.
  const [counts, moduleFlags, permissions, me, activeYear] = await Promise.all([
    getDashboardCounts(locationId),
    getModuleFlags(locationId),
    permissionsForRole(locationId, claims.role),
    getSchoolUserByUid(locationId, claims.uid),
    getActiveAcademicYear(locationId),
  ]);

  const principalScope = await resolvePrincipalScope(locationId, claims.role, me?.id ?? null);
  const scope = await resolveDashboardScope(locationId, principalScope);
  const aggregateScope: AggregateScope = { gradeIds: scope.gradeIds };
  const scopeNote = describeScope(principalScope);

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
  const showAccounting = moduleFlags.accounts && permissions.includes('accounting.read');
  // Exams have no module flag of their own — they ship inside Academics — so
  // the flag is Academics and the gate is the exam permission.
  const showExams = moduleFlags.academics && permissions.includes('exams.read');
  const showLeave = moduleFlags.hr_payroll && permissions.includes('hr.read');

  const now = new Date();
  const lastMonth = new Date(now.getUTCFullYear(), now.getUTCMonth() - 1, 1);

  const [
    today,
    collection,
    outstanding,
    collectionTrend,
    feeSplit,
    aging,
    attendanceTrend,
    attendanceByClass,
    attendance30,
    enrolment,
    setup,
    classStrength,
    funnel,
    outcomes,
    accounting,
    accountingLast,
  ] = await Promise.all([
    settle('today snapshot', locationId, () => getTodaySnapshot(locationId, aggregateScope)),
    showFees
      ? settle('collection comparison', locationId, () =>
          getCollectionComparison(locationId, aggregateScope, now),
        )
      : null,
    showFees
      ? settle('outstanding summary', locationId, () =>
          getOutstandingSummary(locationId, aggregateScope, now),
        )
      : null,
    showFees
      ? settle('collection trend', locationId, () =>
          getCollectionTrend(locationId, aggregateScope),
        )
      : null,
    showFees
      ? settle('fee status split', locationId, () =>
          getFeeStatusSplit(locationId, aggregateScope),
        )
      : null,
    showFees
      ? settle('ageing buckets', locationId, () => getAgingBuckets(locationId, aggregateScope))
      : null,
    showAttendance
      ? settle('attendance trend', locationId, () =>
          getAttendanceTrend(locationId, aggregateScope),
        )
      : null,
    showAttendance
      ? settle('attendance by class', locationId, () =>
          getAttendanceByClass(locationId, aggregateScope),
        )
      : null,
    showAttendance
      ? settle('attendance average', locationId, () =>
          getAttendanceAverage(locationId, aggregateScope),
        )
      : null,
    settle('enrolment comparison', locationId, () =>
      getEnrolmentComparison(locationId, aggregateScope),
    ),
    /*
     * Indexed counts, and deliberately **not** scoped.
     *
     * `aggregateScope` used to be passed here and it produced the defect this
     * sprint was called for: an unassigned head at a `multiple` school reads
     * `gradeIds: []`, three of the six steps short-circuited to zero, and the
     * principal was shown 50% against the administrator's 100%. Whether the
     * school has created its classes or priced its fees is a fact about the
     * school. See `getSetupProgress`, which no longer takes a scope at all.
     *
     * Wrapped like everything else here: a school that cannot be counted still
     * has a dashboard.
     */
    settle('setup progress', locationId, () => getSetupProgress(locationId)),
    showEnrolment
      ? settle('class strength', locationId, () => getClassStrength(locationId, aggregateScope))
      : null,
    showEnrolment
      ? settle('admissions funnel', locationId, () =>
          getAdmissionsFunnel(locationId, aggregateScope),
        )
      : null,
    showExams
      ? settle('recent exam outcomes', locationId, () =>
          getRecentExamOutcomes(locationId, undefined, aggregateScope),
        )
      : null,
    showAccounting
      ? settle('accounting overview', locationId, () =>
          getAccountingOverview(locationId, monthOf(now)),
        )
      : null,
    showAccounting
      ? settle('accounting last month', locationId, () =>
          getAccountingOverview(locationId, monthOf(lastMonth)),
        )
      : null,
  ]);

  // The exceptions read depends on the outstanding count, which is already in
  // hand, so it costs four queries rather than five.
  const exceptions = await settle('exceptions', locationId, () =>
    getDashboardExceptions(
      locationId,
      aggregateScope,
      {
        fees: showFees,
        attendance: showAttendance,
        exams: showExams,
        hr: showLeave,
        email: permissions.includes('comms.read'),
      },
      {
        academicYearId: activeYear?.id ?? null,
        overdueChallans: outstanding?.overdueCount ?? 0,
      },
      now,
    ),
  );

  const totalStrength = classStrength?.reduce((sum, row) => sum + row.value, 0) ?? 0;

  /*
   * The chip row. Ordered by how often it is wanted rather than by module: an
   * administrator opening this screen is far more often inviting somebody or
   * looking at a challan than they are visiting a module's landing page, and
   * the modules are already in the sidebar.
   */
  const quickLinks: QuickLink[] = [
    ...(canInvite
      ? [
          {
            label: 'Invite staff',
            href: '/dashboard/users/invite',
            icon: 'users' as const,
            description: 'Send an email invitation to a new team member.',
            emphasis: true,
          },
        ]
      : []),
    ...(showEnrolment
      ? [
          {
            label: 'Enrol a student',
            href: '/dashboard/admissions/enroll',
            icon: 'enroll' as const,
            description: 'Add one child to the roll.',
          },
        ]
      : []),
    ...(showFees
      ? [
          {
            label: 'Challans',
            href: '/dashboard/fees/challans',
            icon: 'challans' as const,
            description: 'Generate, print and record payments.',
          },
        ]
      : []),
    ...(showAttendance
      ? [
          {
            label: 'Attendance',
            href: '/dashboard/academics/attendance',
            icon: 'attendance' as const,
            description: 'Take or review a register.',
          },
        ]
      : []),
    ...(permissions.includes('settings.write')
      ? [
          {
            label: 'School settings',
            href: '/dashboard/settings',
            icon: 'settings' as const,
            description: 'Your school profile and branding.',
          },
        ]
      : []),
    ...(permissions.includes('permissions.manage')
      ? [
          {
            label: 'Roles & permissions',
            href: '/dashboard/settings/permissions',
            icon: 'settings' as const,
            description: 'Decide what each role may see and do.',
          },
        ]
      : []),
    ...(permissions.includes('principals.manage')
      ? [
          {
            label: 'Principals & divisions',
            href: '/dashboard/settings',
            icon: 'users' as const,
            description: 'Assign heads to campuses and grades.',
          },
        ]
      : []),
    // The enabled modules keep their place, last: they are landing pages rather
    // than actions, and the sidebar already carries them.
    ...enabledModules
      .filter((entry) => MODULE_HOMES[entry.key] !== undefined)
      .map((entry) => ({
        label: entry.label,
        href: MODULE_HOMES[entry.key] as string,
        description: MODULE_DESCRIPTIONS[entry.key],
      })),
    {
      label: 'Feedback',
      href: '/dashboard/feedback',
      icon: 'feedback' as const,
      description: 'Tell us about a bug, or ask for something.',
    },
  ];

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

      {/*
        BR4's sentence. Without it a narrowed head reads a short list as a
        broken page, which is the failure `describeScope` exists to prevent.

        ── Why the unassigned case is a warning and not grey text (Sprint 17) ─
        A head with *some* division is being told which one, and grey helper
        text is the right weight for that. A head with **none** is being told
        something else entirely: every screen in this portal will be empty for
        them until an administrator acts, and that is not a note, it is the
        state of their whole account. LGS's principal met exactly this — the
        school runs `principal_model = 'multiple'` with zero assignments — and
        read the empty screens as a broken product rather than as a setting.

        So the unassigned case gets an alert callout and a link to the screen
        where assignments are made. `resolvePrincipalScope` is not relaxed to
        compensate: "no assignment" must never resolve to "no filter".
      */}
      {scopeNote === null ? null : principalScope.scoped &&
        principalScope.unassigned ? (
        <Card className="border-status-warning/50">
          <div
            role="alert"
            className="flex gap-3 rounded-lg bg-status-warning-subtle px-3 py-3 text-sm text-status-warning-onSubtle"
          >
            <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">{scopeNote}</p>
              <p className="mt-1">
                Until then every list, chart and register on this portal will be
                empty — not because the school has nothing in it, but because
                none of it has been assigned to you yet.
              </p>
              <Link
                href="/dashboard/settings"
                className="mt-2 inline-flex font-medium underline"
              >
                Principal assignments →
              </Link>
            </div>
          </div>
        </Card>
      ) : (
        <Card>
          <p className="text-sm text-ink-muted">{scopeNote}</p>
        </Card>
      )}

      {/*
        The shortcuts, at the top rather than under nine charts.

        They were a grid of bordered tiles at the foot of this page — two
        scrolls past the fold, below the part of the screen nobody clicks. A
        chip row reads as a toolbar rather than as the page's content, which is
        what stopped the old tiles from being able to sit up here at all.

        Every entry is gated on the permission the destination itself enforces,
        never on the role name. A principal holds none of the last three and so
        sees none of them, without this file having to know what a principal is.
      */}
      <QuickLinks links={quickLinks} ariaLabel="Quick links" />

      <ExceptionsStrip exceptions={exceptions} />

      {/*
        Setup progress, above the money. A school missing three of these six has
        a product that does not work yet, and no collections chart is the more
        urgent thing to look at until that is fixed. Once every step is in place
        the card collapses to one line and the numbers become a summary of the
        school rather than a checklist.
      */}
      {setup === null ? null : <SetupProgressCard progress={setup} />}

      <StatTileGrid>
        {showFees ? (
          <StatTile
            label="Collected this month"
            icon={Banknote}
            value={collection === null ? undefined : formatPkr(collection.thisMonth)}
            unavailable={
              collection === null ? 'This month’s collections could not be read.' : undefined
            }
            delta={collection === null ? undefined : percentDelta(collection.thisMonth, collection.lastMonthToDate)}
            deltaMeaning={
              collection === null || collection.thisMonth === collection.lastMonthToDate
                ? 'neutral'
                : collection.thisMonth > collection.lastMonthToDate
                  ? 'good'
                  : 'bad'
            }
            deltaPeriod="vs the same point last month"
            detail={
              today === null ? undefined : `${formatPkr(today.collectedToday)} received today`
            }
            visual={
              collectionTrend === null || collectionTrend.length === 0 ? undefined : (
                <Sparkline
                  values={collectionTrend.map((point) => point.value)}
                  label={`Collections over the last ${collectionTrend.length} months`}
                />
              )
            }
          />
        ) : null}

        {showFees ? (
          <StatTile
            label="Outstanding this month"
            icon={Receipt}
            value={
              outstanding === null ? undefined : formatPkr(outstanding.outstandingThisMonth)
            }
            unavailable={outstanding === null ? 'The fee figures could not be read.' : undefined}
            delta={
              outstanding === null || outstanding.overdueCount === 0
                ? undefined
                : `${outstanding.overdueCount.toLocaleString()} past due`
            }
            deltaMeaning={
              outstanding !== null && outstanding.overdueCount > 0 ? 'bad' : 'neutral'
            }
            deltaKind="state"
            detail={
              outstanding === null
                ? undefined
                : outstanding.defaulterCount === 0
                  ? 'Nobody is behind'
                  : `${outstanding.defaulterCount.toLocaleString()} student${
                      outstanding.defaulterCount === 1 ? '' : 's'
                    } behind on a challan`
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
              today === null || today.attendanceRateToday === null
                ? undefined
                : `${today.attendanceRateToday}%`
            }
            unavailable={
              today === null
                ? 'Today’s figures could not be read.'
                : today.attendanceRateToday === null
                  ? 'No register taken yet today.'
                  : undefined
            }
            delta={
              today?.attendanceRateToday == null || attendance30 == null
                ? undefined
                : `${today.attendanceRateToday >= attendance30 ? '+' : ''}${
                    Math.round((today.attendanceRateToday - attendance30) * 10) / 10
                  } pts`
            }
            deltaMeaning={
              today?.attendanceRateToday == null ||
              attendance30 == null ||
              today.attendanceRateToday === attendance30
                ? 'neutral'
                : today.attendanceRateToday > attendance30
                  ? 'good'
                  : 'bad'
            }
            deltaPeriod="vs the 30-day average"
            detail="Present or late, of everyone marked"
          />
        ) : null}

        <StatTile
          label="Enrolled students"
          icon={GraduationCap}
          value={
            enrolment === null ? counts.students.toLocaleString() : enrolment.now.toLocaleString()
          }
          delta={
            enrolment === null
              ? undefined
              : `${enrolment.now >= enrolment.atYearStart ? '+' : ''}${
                  enrolment.now - enrolment.atYearStart
                }`
          }
          deltaMeaning={
            enrolment === null || enrolment.now === enrolment.atYearStart
              ? 'neutral'
              : enrolment.now > enrolment.atYearStart
                ? 'good'
                : 'bad'
          }
          deltaPeriod="since the year opened"
          detail={
            counts.activeYearName === null
              ? 'No active academic year'
              : `Enrolled in ${counts.activeYearName}`
          }
        />

        {/*
          Three separate conditions have to hold before a figure appears here —
          the module on, `accounting.read` held, and a chart of accounts set up —
          and a zero would be a lie under any of them.

          A fourth condition was added in Sprint 15: the ledger is not divided by
          division, so a scoped principal is told that rather than shown the
          whole school's net under a heading that says "yours".
        */}
        {scope.gradeIds !== null ? (
          <StatTile
            label="Net this month"
            icon={TrendingUp}
            unavailable="The ledger is kept for the whole school, not per division."
          />
        ) : accounting !== null && accounting.isSetUp ? (
          <StatTile
            label="Net this month"
            value={formatPkr(accounting.monthProfitPaise / 100)}
            icon={accounting.monthProfitPaise >= 0 ? TrendingUp : TrendingDown}
            deltaMeaning={
              accountingLast === null ||
              accounting.monthProfitPaise === accountingLast.monthProfitPaise
                ? 'neutral'
                : accounting.monthProfitPaise > accountingLast.monthProfitPaise
                  ? 'good'
                  : 'bad'
            }
            delta={
              accountingLast === null
                ? undefined
                : percentDelta(accounting.monthProfitPaise, accountingLast.monthProfitPaise)
            }
            deltaPeriod="vs last month"
            detail={`${formatPkr(accounting.monthIncomePaise / 100)} in, ${formatPkr(
              accounting.monthExpensePaise / 100,
            )} out`}
          />
        ) : (
          <StatTile
            label="Net this month"
            icon={TrendingUp}
            unavailable={
              !showAccounting
                ? 'Needs the Accounts & Finance module.'
                : accounting === null
                  ? 'The accounts could not be read.'
                  : 'This school has no chart of accounts yet.'
            }
          />
        )}
      </StatTileGrid>

      {/*
        Each card stays even when its read failed, and says so.

        Dropping it was the original behaviour and it is the wrong failure: a
        dashboard missing its collection chart looks exactly like a dashboard
        for a school that has no fee module, and an administrator has no way to
        tell "this is not for you" from "this broke".
      */}
      {showFees ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card
            header={
              <CardTitle
                title={trendTitle('Collections', collectionTrend)}
                description="Payments received per month"
              />
            }
          >
            {collectionTrend === null ? (
              <ChartUnavailable />
            ) : (
              <LineChart
                title="Fee collection by month"
                summary={summariseTrend(collectionTrend, (value) => formatPkr(value))}
                categories={collectionTrend.map((point) => point.label)}
                series={[
                  { label: 'Collected', values: collectionTrend.map((point) => point.value) },
                ]}
                area
              />
            )}
          </Card>

          <Card
            header={
              <CardTitle
                title="This year's billing"
                description="Collected, still to fall due, and past due"
              />
            }
          >
            {feeSplit === null ? (
              <ChartUnavailable />
            ) : (
              <DonutChart
                title="Fee status"
                summary={feeSplitSummary(feeSplit)}
                slices={[
                  {
                    label: 'Collected',
                    value: feeSplit.collected,
                    fillClass: 'fill-status-success',
                  },
                  {
                    label: 'Not yet due',
                    value: feeSplit.outstanding,
                    fillClass: 'fill-status-info',
                  },
                  { label: 'Overdue', value: feeSplit.overdue, fillClass: 'fill-status-danger' },
                ]}
                format={(value) => formatPkr(value)}
                centerValue={formatPkr(
                  feeSplit.collected + feeSplit.outstanding + feeSplit.overdue,
                )}
                centerLabel="billed this year"
              />
            )}
          </Card>

          <Card
            header={
              <CardTitle
                title="Ageing of receivables"
                description="What is owed, by how long it has been owed"
              />
            }
          >
            {aging === null ? (
              <ChartUnavailable />
            ) : (
              // Ordered buckets, so the x axis is *not* sorted by value. The
              // order is the information: money moving right across this chart
              // is money getting harder to collect.
              <BarChart
                title="Outstanding by age"
                summary={agingSummary(aging)}
                categories={aging.map((row) => row.label)}
                series={[{ label: 'Outstanding', values: aging.map((row) => row.value) }]}
                format={(value) => formatPkr(value)}
              />
            )}
          </Card>

          <Card
            header={
              <CardTitle
                title="Admissions funnel"
                description="Every application this school has taken, by stage"
              />
            }
          >
            {!showEnrolment ? (
              <p className="py-8 text-center text-sm text-ink-muted">
                Needs the Admissions module.
              </p>
            ) : funnel === null ? (
              <ChartUnavailable />
            ) : (
              <BarChart
                title="Applications by stage"
                summary={funnelSummary(funnel)}
                categories={funnel.map((row) => row.label)}
                series={[{ label: 'Applications', values: funnel.map((row) => row.value) }]}
                format={(value) => String(Math.round(value))}
                orientation="horizontal"
              />
            )}
          </Card>
        </div>
      ) : null}

      {showAttendance ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card
            header={
              <CardTitle
                title={trendTitle('Attendance', attendanceTrend)}
                description="Monthly rate across the school"
              />
            }
          >
            {attendanceTrend === null ? (
              <ChartUnavailable />
            ) : (
              <LineChart
                title="Attendance rate by month"
                summary={summariseTrend(attendanceTrend, (value) => `${value}%`)}
                categories={attendanceTrend.map((point) => point.label)}
                series={[
                  { label: 'Attendance', values: attendanceTrend.map((point) => point.value) },
                ]}
                format={(value) => `${Math.round(value)}%`}
              />
            )}
          </Card>

          <Card
            header={
              <CardTitle
                title="Attendance by class"
                description={`Worst first, over the last 30 days. Anything under ${ATTENDANCE_CONCERN}% is marked.`}
              />
            }
          >
            {attendanceByClass === null ? (
              <ChartUnavailable />
            ) : (
              <WorstClasses rows={attendanceByClass} />
            )}
          </Card>
        </div>
      ) : null}

      {/*
        Class strength and Recent exam outcomes, in the same two-column grid as
        every other pair on this page.

        They were two full-width cards, and that is what made them look wrong.
        Both charts are a fixed 640-unit viewBox scaled to their container, so
        at ~1200px wide the same SVG renders around twice the height of the
        eight charts above it — the bars twice as thick, the labels twice the
        size, and the whole card reading as a different component. Nothing about
        the charts needed changing; they needed to be the same width as their
        siblings.
      */}
      <div className="grid gap-5 lg:grid-cols-2">
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

        {showExams && outcomes !== null && outcomes.length > 0 ? (
        <Card
          header={
            <CardTitle
              title="Recent exam outcomes"
              description="Pass rate and average for the most recently published papers"
            />
          }
        >
          {/*
            Percentages, never letter grades. Each exam is graded against its own
            term's scheme, so an "A" column would stack two different meanings of
            A for a school that changed schemes between terms.
          */}
          <BarChart
            title="Pass rate and average by exam"
            summary={outcomesSummary(outcomes)}
            categories={outcomes.map((row) => `${row.title} · ${row.className}`)}
            series={[
              {
                label: 'Pass rate',
                values: outcomes.map((row) => row.passRate ?? 0),
              },
              {
                label: 'Average',
                values: outcomes.map((row) => row.average ?? 0),
              },
            ]}
            format={(value) => `${Math.round(value)}%`}
            orientation="horizontal"
          />
        </Card>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The morning's exceptions, above everything else on the screen.
 *
 * Absent entirely when nothing is wrong. A strip that is loud on a good day
 * trains people to ignore it on the day it is not, which is exactly the failure
 * mode of a dashboard with a permanent red badge on it.
 */
function ExceptionsStrip({ exceptions }: { exceptions: DashboardException[] | null }) {
  if (exceptions === null || exceptions.length === 0) return null;

  return (
    <section aria-label="Needs attention" className="flex flex-wrap gap-3">
      {exceptions.map((entry) => (
        <Link
          key={entry.key}
          href={entry.href}
          className="flex items-baseline gap-2 rounded-card border border-status-danger bg-status-danger-subtle px-4 py-2.5 text-status-danger-onSubtle transition hover:shadow-raised"
        >
          <span className="text-lg font-bold tabular-nums">
            {entry.count.toLocaleString()}
          </span>
          {/* The number is never alone: the label is the status. */}
          <span className="text-sm">{entry.label}</span>
        </Link>
      ))}
    </section>
  );
}

/**
 * Attendance by class, worst first, with the classes below the line marked.
 *
 * Sorted *ascending* on purpose: the point of this panel is finding the class
 * that needs a phone call, and a chart sorted by the best class buries it at
 * the bottom. The threshold is stated in the card's description and the marked
 * classes are named in the summary, so the colour is a second signal on a fact
 * already in words rather than the only carrier of it.
 */
function WorstClasses({ rows }: { rows: ReadonlyArray<{ label: string; value: number }> }) {
  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-ink-muted">
        No register has been taken in the last 30 days.
      </p>
    );
  }

  const sorted = [...rows].sort((left, right) => left.value - right.value).slice(0, 10);
  const concerning = sorted.filter((row) => row.value < ATTENDANCE_CONCERN);

  return (
    <BarChart
      title="Attendance rate by class"
      summary={
        concerning.length === 0
          ? `Every class is at or above ${ATTENDANCE_CONCERN}%. The lowest is ${sorted[0]!.label} at ${sorted[0]!.value}%.`
          : `${concerning.length} class${concerning.length === 1 ? '' : 'es'} below ${ATTENDANCE_CONCERN}%: ${concerning
              .map((row) => `${row.label} at ${row.value}%`)
              .join(', ')}.`
      }
      categories={sorted.map((row) => row.label)}
      series={[
        {
          label: 'Attendance',
          values: sorted.map((row) => row.value),
          fillClasses: sorted.map((row) =>
            row.value < ATTENDANCE_CONCERN ? 'fill-status-warning' : undefined,
          ),
        },
      ]}
      format={(value) => `${Math.round(value)}%`}
      orientation="horizontal"
    />
  );
}

/** Stands in for a chart whose data could not be read. */
function ChartUnavailable() {
  return (
    <p className="py-8 text-center text-sm text-ink-muted">
      This chart could not be loaded. Everything else on this page is current.
    </p>
  );
}

/** `+12%`, `-4%`, or `—` where last month was nothing to divide by. */
function percentDelta(now: number, before: number): string | undefined {
  if (before === 0) return now === 0 ? undefined : 'New';
  const change = Math.round((100 * (now - before)) / Math.abs(before));
  return `${change >= 0 ? '+' : ''}${change}%`;
}

/**
 * A card title that states the insight when there is one, and the metric when
 * there is not. A title asserting a trend the data does not show is worse than
 * a label.
 */
function trendTitle(
  noun: string,
  points: ReadonlyArray<{ value: number }> | null,
): string {
  if (points === null || points.length < 4) return noun;

  const half = Math.floor(points.length / 2);
  const early = points.slice(0, half).reduce((sum, point) => sum + point.value, 0);
  const late = points.slice(half).reduce((sum, point) => sum + point.value, 0);
  if (early === 0 || early === late) return noun;

  const change = Math.round((100 * (late - early)) / early);
  if (Math.abs(change) < 5) return `${noun} are steady`;

  return `${noun} ${change > 0 ? 'up' : 'down'} ${Math.abs(change)}% on the first half of the year`;
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

function feeSplitSummary(split: {
  collected: number;
  outstanding: number;
  overdue: number;
}): string {
  const total = split.collected + split.outstanding + split.overdue;
  if (total === 0) return 'Nothing has been billed this academic year yet.';

  const share = (value: number): string => `${Math.round((100 * value) / total)}%`;

  return `Of ${formatPkr(total)} billed this year, ${share(split.collected)} is collected, ${share(
    split.outstanding,
  )} is not yet due and ${share(split.overdue)} is overdue.`;
}

function agingSummary(rows: ReadonlyArray<{ label: string; value: number }>): string {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  if (total === 0) return 'Nothing is outstanding.';

  const oldest = rows[rows.length - 1]!;

  return `${formatPkr(total)} outstanding, of which ${formatPkr(oldest.value)} has been owed for more than 90 days.`;
}

function funnelSummary(rows: ReadonlyArray<{ label: string; value: number }>): string {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  if (total === 0) return 'No applications yet.';

  const parts = rows.filter((row) => row.value > 0).map((row) => `${row.value} ${row.label}`);

  return `${total} application${total === 1 ? '' : 's'}: ${parts.join(', ')}.`;
}

function outcomesSummary(
  rows: ReadonlyArray<{ title: string; className: string; passRate: number | null }>,
): string {
  const graded = rows.filter((row) => row.passRate !== null);
  if (graded.length === 0) return 'No exam has published marks yet.';

  const worst = graded.reduce((low, row) => (row.passRate! < low.passRate! ? row : low), graded[0]!);

  return `${graded.length} exam${graded.length === 1 ? '' : 's'} with published marks. Lowest pass rate: ${worst.title}, ${worst.className}, at ${worst.passRate}%.`;
}
