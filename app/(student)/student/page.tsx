import type { Metadata } from 'next';
import Link from 'next/link';
import { CalendarClock, ClipboardCheck, GraduationCap, Receipt } from 'lucide-react';

import { LineChart } from '@/components/charts/LineChart';
import { DashboardNotices } from '@/components/school/DashboardNotices';
import { Badge } from '@/components/ui/Badge';
import { Card, CardTitle } from '@/components/ui/Card';
import { QuickLinks } from '@/components/ui/QuickLinks';
import { StatTile, StatTileGrid } from '@/components/ui/StatTile';
import { PROMOTION_STATUS_LABELS } from '@/db/schema';
import {
  getActiveAcademicYear,
  getCurrentEnrollment,
  getStudentBySchoolUserId,
} from '@/lib/admissions-queries';
import { listNoticesFor } from '@/lib/announcement-queries';
import { settle } from '@/lib/dashboard-queries';
import { getStudentFeeSummary } from '@/lib/fee-queries';
import { formatPkr, toPaise } from '@/lib/money';
import {
  getChildSnapshot,
  getStudentDay,
  getStudentSectionId,
  weekdayIndex,
  type StudentPeriod,
} from '@/lib/portal-dashboard';
import { requireSchoolRole } from '@/lib/school-guard';
import { getSchoolUserByUid } from '@/lib/school-queries';

export const metadata: Metadata = {
  title: 'Student dashboard',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DATE = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

const SHORT_DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/**
 * The student's own dashboard.
 *
 * **Decision it informs:** what is next, and how did I do.
 *
 * Everything shown is looked up from the uid in their verified session, so a
 * student can only ever see their own record — there is no id in the URL that
 * could be changed to somebody else's.
 *
 * ── The timetable resolves its own bell schedule ─────────────────────────
 * `getStudentDay` calls `listSlotsForSection`, never the unscoped
 * `listTimetableSlots` — CLAUDE.md. Which schedule a class runs on is decided
 * by its grade, and the unscoped call lays an infant class out against the
 * senior school's eight rows.
 *
 * ── Published results only ───────────────────────────────────────────────
 * Both the latest result and the term-by-term line come from
 * `getChildSnapshot`, whose only routes to a mark are
 * `listPublishedTermsForStudent` and `listStudentResultHistory`. A student
 * learning a promotion decision before the school has published it is the
 * school being told by its own software.
 *
 * ── Failure isolation ────────────────────────────────────────────────────
 * Six independent reads, each through `settle`. A student whose exam module is
 * mid-migration must still be able to see what room they are in at 11:00.
 */
export default async function StudentDashboardPage() {
  const { claims, locationId } = await requireSchoolRole(['student']);
  const profile = await getSchoolUserByUid(locationId, claims.uid);

  const firstName = (profile?.name ?? '').split(' ')[0] ?? '';
  const now = new Date();
  const isWeekend = weekdayIndex(now) === null;

  const [student, activeYear] =
    profile === null
      ? [null, null]
      : await Promise.all([
          getStudentBySchoolUserId(locationId, profile.id),
          getActiveAcademicYear(locationId),
        ]);

  const sectionId =
    student === null || activeYear === null
      ? null
      : await settle('student section', locationId, () =>
          getStudentSectionId(locationId, student.studentProfileId, activeYear.id),
        );

  const [enrollment, fees, snapshot, day, notices] = await Promise.all([
    student === null || activeYear === null
      ? Promise.resolve(null)
      : settle('enrolment', locationId, () =>
          getCurrentEnrollment(locationId, student.studentProfileId, activeYear.id),
        ),
    student === null
      ? Promise.resolve(null)
      : settle('fee summary', locationId, () =>
          getStudentFeeSummary(locationId, student.studentProfileId),
        ),
    student === null
      ? Promise.resolve(null)
      : settle('student snapshot', locationId, () =>
          getChildSnapshot(locationId, student.studentProfileId, activeYear?.id ?? null, now),
        ),
    sectionId === null || activeYear === null
      ? Promise.resolve(null)
      : settle('student day', locationId, () =>
          getStudentDay(locationId, sectionId, activeYear.id, now),
        ),
    profile === null
      ? Promise.resolve(null)
      : settle('notices', locationId, () => listNoticesFor(locationId, profile.id, 10)),
  ]);

  const attendance = snapshot?.attendance ?? null;
  const attendanceMarked =
    attendance === null
      ? 0
      : attendance.present + attendance.absent + attendance.late + attendance.excused;
  const result = snapshot?.latestResult ?? null;
  const trend = (snapshot?.resultTrend ?? []).filter(
    (row) => row.overallPercentage !== null,
  );

  return (
    <div className="space-y-6">
      {/* Shortcuts as chips, above the greeting. */}
      <QuickLinks
        links={[
          { label: 'Timetable', href: '/student/timetable', icon: 'timetable', emphasis: true },
          { label: 'Results', href: '/student/results', icon: 'reportCards' },
          { label: 'Exams', href: '/student/exams', icon: 'exams' },
          { label: 'Fees', href: '/student/fees', icon: 'fees' },
          { label: 'Notices', href: '/student/announcements', icon: 'announcements' },
        ]}
      />

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-ink">
              Welcome{firstName === '' ? '' : `, ${firstName}`}.
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              {student === null
                ? 'Your student record is still being set up. Your class details will appear here once your school completes your enrolment.'
                : enrollment === null
                  ? activeYear === null
                    ? 'Your school has not opened an academic year yet.'
                    : `No placement is recorded for you in ${activeYear.name}.`
                  : `${DATE.format(now)} · ${enrollment.gradeName} ${enrollment.sectionName}${
                      enrollment.rollNumber === null ? '' : ` · Roll ${enrollment.rollNumber}`
                    }`}
            </p>
          </div>

          {student === null ? null : (
            <Badge variant="neutral">
              <span className="font-mono">{student.studentId}</span>
            </Badge>
          )}
        </div>
      </Card>

      <StatTileGrid>
        <StatTile
          label="Attendance this month"
          icon={ClipboardCheck}
          // Nothing marked yet is not 0%. On the 1st of a month those are
          // opposite statements and one of them is alarming.
          value={
            attendance === null || attendanceMarked === 0
              ? undefined
              : `${attendance.percentage}%`
          }
          unavailable={
            snapshot === null
              ? 'Your attendance could not be read.'
              : attendanceMarked === 0
                ? 'No register taken yet this month.'
                : undefined
          }
          deltaMeaning={
            attendance !== null && attendanceMarked > 0 && attendance.percentage < 85
              ? 'bad'
              : 'good'
          }
          delta={
            attendance === null || attendanceMarked === 0
              ? undefined
              : `${attendance.present + attendance.late} of ${attendanceMarked} days`
          }
          detail="Present or late, of the days marked"
        />

        <StatTile
          label="Next exam"
          icon={CalendarClock}
          value={snapshot?.nextExam?.title}
          unavailable={
            snapshot === null
              ? 'Your datesheet could not be read.'
              : snapshot.nextExam === null
                ? 'Nothing on your datesheet yet.'
                : undefined
          }
          detail={
            snapshot?.nextExam == null
              ? undefined
              : `${SHORT_DATE.format(
                  new Date(`${snapshot.nextExam.examDate}T00:00:00`),
                )} · ${snapshot.nextExam.termName}`
          }
        />

        <StatTile
          label="Latest result"
          icon={GraduationCap}
          value={
            result === null
              ? undefined
              : result.overallPercentage === null
                ? (result.overallGradeLabel ?? '—')
                : `${result.overallPercentage}%`
          }
          unavailable={
            snapshot === null
              ? 'Your results could not be read.'
              : result === null
                ? 'No report card has been published yet.'
                : undefined
          }
          detail={
            result === null
              ? undefined
              : `${result.termName} · ${PROMOTION_STATUS_LABELS[result.finalStatus]}`
          }
        />

        <StatTile
          label="Fee balance"
          icon={Receipt}
          value={fees === null ? undefined : formatPkr(fees.balance)}
          unavailable={fees === null ? 'Your fee details could not be read.' : undefined}
          deltaMeaning={fees !== null && toPaise(fees.balance) > 0 ? 'bad' : 'good'}
          delta={
            fees === null
              ? undefined
              : toPaise(fees.balance) > 0
                ? 'Payment due'
                : 'Nothing outstanding'
          }
          detail={
            fees?.oldestUnpaid == null
              ? 'Fees cannot be paid through this portal'
              : `Oldest ${fees.oldestUnpaid.challanNumber}, due ${fees.oldestUnpaid.dueDate}`
          }
        />
      </StatTileGrid>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card
          header={
            <CardTitle
              title="Today"
              description="Your periods in clock order"
              action={
                <Link
                  href="/student/timetable"
                  className="text-sm font-medium text-brand-primary hover:underline"
                >
                  Whole week
                </Link>
              }
            />
          }
          className="p-0"
        >
          {day === null ? (
            <p className="px-5 py-4 text-sm text-ink-muted">
              {sectionId === null
                ? 'Your timetable appears here once you are placed in a class.'
                : 'Your timetable could not be loaded.'}
            </p>
          ) : isWeekend ? (
            <p className="px-5 py-4 text-sm text-ink-muted">
              No classes today. Your week starts again on Monday.
            </p>
          ) : day.length === 0 ? (
            <p className="px-5 py-4 text-sm text-ink-muted">
              Your class has no timetable for today yet.
            </p>
          ) : (
            <ol className="divide-y divide-line">
              {day.map((period) => (
                <PeriodRow key={period.slotId} period={period} />
              ))}
            </ol>
          )}
        </Card>

        <Card
          header={
            <CardTitle
              title="Results across terms"
              description="Your overall percentage in every published term"
              action={
                <Link
                  href="/student/results"
                  className="text-sm font-medium text-brand-primary hover:underline"
                >
                  Report cards
                </Link>
              }
            />
          }
        >
          {snapshot === null ? (
            <p className="py-8 text-center text-sm text-ink-muted">
              This chart could not be loaded.
            </p>
          ) : trend.length < 2 ? (
            <p className="py-8 text-center text-sm text-ink-muted">
              {trend.length === 0
                ? 'No report card has been published yet.'
                : 'One published term so far. A line appears once there are two to join.'}
            </p>
          ) : (
            // A line, not bars: terms are ordered in time, and the message is
            // the direction of travel rather than a comparison of magnitudes.
            <LineChart
              title="Overall percentage by term"
              summary={trendSummary(trend)}
              categories={trend.map((row) => row.termName)}
              series={[
                {
                  label: 'Overall',
                  values: trend.map((row) => row.overallPercentage),
                },
              ]}
              format={(value) => `${Math.round(value)}%`}
              area
            />
          )}
        </Card>
      </div>

      <DashboardNotices
        notices={notices ?? []}
        href="/student/announcements"
        emptyMessage="Nothing yet. Notices your school sends will appear here."
      />
    </div>
  );
}

/**
 * One period.
 *
 * The current one is marked with a word as well as a border. A ring alone is
 * invisible to a screen reader and to anyone who cannot separate the two greys,
 * and "which period am I in" is the question this panel exists to answer.
 */
function PeriodRow({ period }: { period: StudentPeriod }) {
  const free = period.subjectName === '';

  return (
    <li
      className={
        period.isNow
          ? 'border-l-4 border-brand-primary bg-brand-primarySubtle px-5 py-3'
          : 'px-5 py-3'
      }
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className={free ? 'text-sm text-ink-muted' : 'font-medium text-ink'}>
            {free ? period.name : period.subjectName}
            {period.isNow ? (
              <span className="ml-2 text-xs font-semibold uppercase tracking-wide text-brand-onPrimarySubtle">
                Now
              </span>
            ) : null}
          </p>
          {free ? null : (
            <p className="text-sm text-ink-muted">
              {period.teacherName}
              {period.room === null ? '' : ` · ${period.room}`}
            </p>
          )}
        </div>

        <span className="text-sm tabular-nums text-ink-muted">
          {period.startTime}–{period.endTime}
        </span>
      </div>
    </li>
  );
}

/** The sentence a screen reader hears instead of the line. */
function trendSummary(
  rows: ReadonlyArray<{ termName: string; overallPercentage: number | null }>,
): string {
  const first = rows[0]!;
  const last = rows[rows.length - 1]!;
  const direction =
    (last.overallPercentage ?? 0) > (first.overallPercentage ?? 0)
      ? 'rising'
      : (last.overallPercentage ?? 0) < (first.overallPercentage ?? 0)
        ? 'falling'
        : 'steady';

  return `${direction} from ${first.overallPercentage}% in ${first.termName} to ${last.overallPercentage}% in ${last.termName}, across ${rows.length} published terms.`;
}
