import type { Metadata } from 'next';
import Link from 'next/link';
import { CalendarClock, ClipboardCheck, PenLine } from 'lucide-react';

import { DashboardNotices } from '@/components/school/DashboardNotices';
import { Card, CardTitle } from '@/components/ui/Card';
import { QuickLinks } from '@/components/ui/QuickLinks';
import { StatTile, StatTileGrid } from '@/components/ui/StatTile';
import { getActiveAcademicYear } from '@/lib/admissions-queries';
import { listNoticesFor } from '@/lib/announcement-queries';
import { settle } from '@/lib/dashboard-queries';
import {
  getTeacherClasses,
  getTeacherDay,
  getTeacherTasks,
  weekdayIndex,
  type TeacherPeriod,
} from '@/lib/portal-dashboard';
import { requireSchoolRole } from '@/lib/school-guard';
import { getSchoolUserByUid } from '@/lib/school-queries';
import { staffIdForSchoolUser } from '@/lib/staff-self-queries';

export const metadata: Metadata = {
  title: 'Teacher dashboard',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Time-of-day greeting in the school's own timezone context. */
function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

const DATE = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

/**
 * The teacher's dashboard.
 *
 * **Decision it informs:** what do I do next.
 *
 * ── No charts, deliberately ──────────────────────────────────────────────
 * A teacher's screen is a to-do list read between lessons. A trend line on it
 * is decoration: nothing a teacher does at 10:40 depends on the shape of the
 * last twelve months, and every pixel it takes is a pixel off the period that
 * starts in four minutes.
 *
 * ── The timetable resolves its own bell schedule ─────────────────────────
 * `getTeacherDay` calls `listSlotsForTeacher`, never the unscoped
 * `listTimetableSlots` — CLAUDE.md. A physicist who takes one junior class
 * teaches inside two bell schedules; the unscoped call would draw both in full,
 * including five rows that can never be filled and every one of which invites a
 * click.
 *
 * ── Failure isolation ────────────────────────────────────────────────────
 * Every read is through `settle`. A teacher whose lesson-plan table is midway
 * through a migration must still be able to see today's periods.
 */
export default async function TeacherDashboardPage() {
  const { claims, locationId } = await requireSchoolRole(['teacher']);

  const [profile, activeYear] = await Promise.all([
    getSchoolUserByUid(locationId, claims.uid),
    getActiveAcademicYear(locationId),
  ]);

  const firstName = (profile?.name ?? '').split(' ')[0] ?? '';
  const now = new Date();
  const isWeekend = weekdayIndex(now) === null;

  const staffId =
    profile === null
      ? null
      : await settle('staff id', locationId, () =>
          staffIdForSchoolUser(locationId, profile.id),
        );

  const ready = profile !== null && activeYear !== null;

  const [day, tasks, classes, notices] = await Promise.all([
    ready
      ? settle('teacher day', locationId, () =>
          getTeacherDay(locationId, profile.id, activeYear.id, now),
        )
      : null,
    ready
      ? settle('teacher tasks', locationId, () =>
          getTeacherTasks(locationId, profile.id, activeYear.id, staffId ?? null, now),
        )
      : null,
    ready
      ? settle('teacher classes', locationId, () =>
          getTeacherClasses(locationId, profile.id, activeYear.id),
        )
      : null,
    profile === null
      ? null
      : settle('notices', locationId, () => listNoticesFor(locationId, profile.id, 10)),
  ]);

  const teaching = day?.filter((period) => period.subjectName !== '') ?? [];

  return (
    <div className="space-y-6">
      {/*
        Shortcuts as chips, above the greeting. A teacher opens this screen
        between periods; the register and the gradebook are what they came for,
        and both were previously two clicks down the sidebar.
      */}
      <QuickLinks
        links={[
          {
            label: 'Take the register',
            href: '/teacher/attendance',
            icon: 'attendance',
            description: 'Mark today for a class you teach.',
            emphasis: true,
          },
          { label: 'My timetable', href: '/teacher/timetable', icon: 'timetable' },
          { label: 'My classes', href: '/teacher/classes', icon: 'students' },
          { label: 'Gradebook', href: '/teacher/gradebook', icon: 'marks' },
          { label: 'Lesson plans', href: '/teacher/lesson-plans', icon: 'academics' },
          { label: 'Leave', href: '/teacher/leave', icon: 'leave' },
        ]}
      />

      <Card>
        <h2 className="text-lg font-semibold text-ink">
          {greeting()}
          {firstName === '' ? '' : `, ${firstName}`}.
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          {activeYear === null
            ? 'Your school has not opened an academic year yet, so there is no timetable to draw.'
            : `${DATE.format(now)} · ${activeYear.name}`}
        </p>
      </Card>

      <StatTileGrid>
        <StatTile
          label="Periods today"
          icon={CalendarClock}
          value={day === null ? undefined : teaching.length.toLocaleString()}
          unavailable={
            day === null
              ? 'Your timetable could not be read.'
              : isWeekend
                ? 'No classes at the weekend.'
                : undefined
          }
          detail={
            day === null || teaching.length === 0
              ? undefined
              : `${teaching.filter((period) => !period.isPast).length} still to come`
          }
        />

        <StatTile
          label="Registers not taken"
          icon={ClipboardCheck}
          value={tasks === null ? undefined : tasks.unmarkedSections.length.toLocaleString()}
          unavailable={tasks === null ? 'Your classes could not be read.' : undefined}
          deltaMeaning={tasks !== null && tasks.unmarkedSections.length > 0 ? 'bad' : 'good'}
          delta={
            tasks === null
              ? undefined
              : tasks.unmarkedSections.length === 0
                ? 'All done'
                : 'Waiting on you'
          }
          detail="One register per class, per day"
        />

        <StatTile
          label="Marks outstanding"
          icon={PenLine}
          value={tasks === null ? undefined : tasks.papersOutstanding.length.toLocaleString()}
          unavailable={tasks === null ? 'Your papers could not be read.' : undefined}
          deltaMeaning={tasks !== null && tasks.papersOutstanding.length > 0 ? 'bad' : 'good'}
          delta={
            tasks === null
              ? undefined
              : tasks.papersOutstanding.length === 0
                ? 'Nothing late'
                : 'Papers already sat'
          }
          detail="Sat, and still a draft"
        />
      </StatTileGrid>

      {/*
        The to-do list first. A teacher opening this at 08:05 is asking what is
        late, not what the term looks like.
      */}
      <Card
        header={
          <CardTitle
            title="Needs you"
            description="Everything the school is waiting on from you today"
          />
        }
        className="p-0"
      >
        {tasks === null ? (
          <p className="px-5 py-4 text-sm text-ink-muted">
            This list could not be loaded. Your timetable below is current.
          </p>
        ) : tasks.unmarkedSections.length === 0 &&
          tasks.papersOutstanding.length === 0 &&
          tasks.plansMissingNextWeek === 0 &&
          tasks.leaveAwaitingDecision === 0 ? (
          // An empty state that is a success message, not a blank.
          <p className="px-5 py-4 text-sm text-status-success-ink">
            Nothing is waiting on you. Registers taken, marks in, next week
            planned.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {tasks.unmarkedSections.map((section) => (
              <li key={section.sectionId} className="px-5 py-3">
                <Link
                  href={`/teacher/attendance?section=${section.sectionId}`}
                  className="flex flex-wrap items-baseline justify-between gap-2"
                >
                  <span className="font-medium text-ink">{section.label}</span>
                  <span className="text-sm text-status-danger-ink">
                    Register not taken today
                  </span>
                </Link>
              </li>
            ))}

            {tasks.papersOutstanding.map((paper) => (
              <li key={paper.examSubjectId} className="px-5 py-3">
                <Link
                  href={`/teacher/marks/${paper.examSubjectId}`}
                  className="flex flex-wrap items-baseline justify-between gap-2"
                >
                  <span className="font-medium text-ink">
                    {paper.subjectName} · {paper.sectionLabel}
                  </span>
                  <span className="text-sm text-status-danger-ink">
                    Marks not entered · sat {paper.examDate}
                  </span>
                </Link>
              </li>
            ))}

            {tasks.plansMissingNextWeek === 0 ? null : (
              <li className="px-5 py-3">
                <Link
                  href="/teacher/lesson-plans"
                  className="flex flex-wrap items-baseline justify-between gap-2"
                >
                  <span className="font-medium text-ink">Lesson plans</span>
                  <span className="text-sm text-ink-muted">
                    {tasks.plansMissingNextWeek} class
                    {tasks.plansMissingNextWeek === 1 ? '' : 'es'} unplanned for next week
                  </span>
                </Link>
              </li>
            )}

            {tasks.leaveAwaitingDecision === 0 ? null : (
              <li className="px-5 py-3">
                <Link
                  href="/teacher/leave"
                  className="flex flex-wrap items-baseline justify-between gap-2"
                >
                  <span className="font-medium text-ink">Leave</span>
                  <span className="text-sm text-ink-muted">
                    {tasks.leaveAwaitingDecision} request
                    {tasks.leaveAwaitingDecision === 1 ? '' : 's'} awaiting a decision
                  </span>
                </Link>
              </li>
            )}
          </ul>
        )}
      </Card>

      <Card
        header={
          <CardTitle
            title="Today"
            description="Your periods in clock order, free periods included"
            action={
              <Link
                href="/teacher/timetable"
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
            Your timetable could not be loaded.
          </p>
        ) : isWeekend ? (
          <p className="px-5 py-4 text-sm text-ink-muted">
            No classes today. Your week starts again on Monday.
          </p>
        ) : day.length === 0 ? (
          <p className="px-5 py-4 text-sm text-ink-muted">
            You are not timetabled into any period today.
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
            title="My classes"
            description="Every class you teach, with its strength and last register"
            action={
              <Link
                href="/teacher/classes"
                className="text-sm font-medium text-brand-primary hover:underline"
              >
                Rosters
              </Link>
            }
          />
        }
        className="p-0"
      >
        {classes === null ? (
          <p className="px-5 py-4 text-sm text-ink-muted">Your classes could not be loaded.</p>
        ) : classes.length === 0 ? (
          <p className="px-5 py-4 text-sm text-ink-muted">
            You are not timetabled into any class yet. One appears here as soon
            as your school puts you on its timetable.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {classes.map((entry) => (
              <li
                key={entry.sectionId}
                className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3"
              >
                <Link
                  href={`/teacher/classes?section=${entry.sectionId}`}
                  className="font-medium text-ink hover:text-brand-primary"
                >
                  {entry.label}
                </Link>
                <span className="text-sm text-ink-muted">
                  {entry.strength} student{entry.strength === 1 ? '' : 's'} ·{' '}
                  {entry.lastRegister === null
                    ? 'no register yet'
                    : `last register ${entry.lastRegister}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <DashboardNotices
        notices={notices ?? []}
        href="/teacher/announcements"
        emptyMessage="Nothing yet. Notices sent to staff will appear here."
      />
    </div>
  );
}

/**
 * One period.
 *
 * The current one is marked with a word as well as a border. A ring alone is
 * invisible to a screen reader and to anyone who cannot separate the two greys,
 * and "which period am I in" is the single question this panel exists to answer.
 */
function PeriodRow({ period }: { period: TeacherPeriod }) {
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
            {free ? (period.isBreak ? period.name : `${period.name} — free`) : period.subjectName}
            {period.isNow ? (
              <span className="ml-2 text-xs font-semibold uppercase tracking-wide text-brand-onPrimarySubtle">
                Now
              </span>
            ) : null}
          </p>
          {free ? null : (
            <p className="text-sm text-ink-muted">
              {period.className}
              {period.room === null ? '' : ` · ${period.room}`}
            </p>
          )}
        </div>

        <div className="flex items-baseline gap-4">
          <span className="text-sm tabular-nums text-ink-muted">
            {period.startTime}–{period.endTime}
          </span>
          {free || period.sectionId === '' ? null : (
            <Link
              href={`/teacher/attendance?section=${period.sectionId}`}
              className="text-sm font-medium text-brand-primary hover:underline"
            >
              Register
            </Link>
          )}
        </div>
      </div>
    </li>
  );
}
