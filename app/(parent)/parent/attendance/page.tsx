import type { Metadata } from 'next';

import { AttendanceCalendar } from '@/components/parent/AttendanceCalendar';
import { ChildSelector } from '@/components/parent/ChildSelector';
import { DonutChart } from '@/components/charts/DonutChart';
import { Card, CardTitle } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { listStudentAttendance, summariseAttendance } from '@/lib/academics-queries';
import { getActiveAcademicYear, listChildrenForGuardian } from '@/lib/admissions-queries';
import {
  buildCalendarMonth,
  monthBounds,
  parseMonthParam,
} from '@/lib/attendance-calendar';
import { requireSchoolRole } from '@/lib/school-guard';
import { getSchoolUserByUid } from '@/lib/school-queries';

export const metadata: Metadata = {
  title: 'Attendance',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * A parent's view of their children's attendance — Sprint 13.
 *
 * ── What changed, and why ────────────────────────────────────────────────
 * This was a list of the last thirty days. A list answers "which days was my
 * child away"; it cannot answer "is there a pattern", which is the question a
 * parent actually has and the one a school wants them to have. A month grid
 * puts every Monday in one column, so "off sick every Monday" is visible
 * without anybody counting.
 *
 * The month is a URL parameter, so this page has no client JavaScript at all
 * and a particular month is shareable — the same reasoning the report filters
 * follow.
 *
 * ── On authorisation ─────────────────────────────────────────────────────
 * The child list comes from `student_guardians.school_user_id` — the link
 * between this signed-in parent and a child — and `?child=` can only select
 * among the children that query already returned. An id belonging to another
 * family therefore resolves to nothing rather than to somebody else's record.
 */
export default async function ParentAttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ child?: string; month?: string }>;
}) {
  const { claims, locationId } = await requireSchoolRole(['parent']);
  const profile = await getSchoolUserByUid(locationId, claims.uid);

  const activeYear = await getActiveAcademicYear(locationId);
  const children =
    profile === null
      ? []
      : await listChildrenForGuardian(locationId, profile.id, activeYear?.id ?? null);

  const { child: requestedChild, month: requestedMonth } = await searchParams;

  const selected =
    children.find((entry) => entry.studentProfileId === requestedChild) ??
    children[0] ??
    null;

  if (selected === null) {
    return (
      <div className="space-y-6">
        <Heading />
        <Card>
          <p className="text-sm text-ink-muted">
            No children are recorded against your account yet, so there is no
            attendance to show. Your school admin can link you to your
            child&rsquo;s record.
          </p>
        </Card>
      </div>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const { year, month } = parseMonthParam(requestedMonth, {
    year: Number.parseInt(today.slice(0, 4), 10),
    month: Number.parseInt(today.slice(5, 7), 10),
  });

  const records = await listStudentAttendance(
    locationId,
    selected.studentProfileId,
    monthBounds(year, month),
  );
  const summary = summariseAttendance(records);
  const calendar = buildCalendarMonth(year, month, records, today);

  return (
    <div className="space-y-6">
      <Heading />

      <ChildSelector
        students={children}
        selectedId={selected.studentProfileId}
        basePath="/parent/attendance"
        extraParams={{ month: `${year}-${String(month).padStart(2, '0')}` }}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="grid gap-4 sm:grid-cols-2">
          <SummaryCard label="Present" value={String(summary.present)} />
          <SummaryCard
            label="Absent"
            value={String(summary.absent)}
            emphasis={summary.absent > 0}
          />
          <SummaryCard label="Late" value={String(summary.late)} />
          <SummaryCard
            label="Attendance"
            value={`${summary.percentage.toFixed(1)}%`}
            emphasis={summary.percentage < 75 && records.length > 0}
          />
        </div>

        {/*
          The ring repeats the four figures beside it rather than adding new
          ones, and that is the point: a parent opening this on a phone wants
          "is my child's attendance all right", and one shape answers that
          faster than four numbers do.

          Holidays are excluded from the slices for the same reason they are
          excluded from the percentage — a term break is not a day anybody
          failed to attend.
        */}
        {records.length === 0 ? null : (
          <Card>
            <DonutChart
              title={`${selected.name}'s attendance`}
              summary={`${summary.percentage.toFixed(1)}% attendance in ${calendar.label}: present ${summary.present}, late ${summary.late}, absent ${summary.absent}, excused ${summary.excused}.`}
              centerValue={`${Math.round(summary.percentage)}%`}
              centerLabel="attendance"
              slices={[
                { label: 'Present', value: summary.present, fillClass: 'fill-status-success' },
                { label: 'Late', value: summary.late, fillClass: 'fill-status-warning' },
                { label: 'Absent', value: summary.absent, fillClass: 'fill-status-danger' },
                { label: 'Excused', value: summary.excused, fillClass: 'fill-status-info' },
              ].filter((slice) => slice.value > 0)}
              format={(value) => `${value} day${value === 1 ? '' : 's'}`}
            />
          </Card>
        )}
      </div>

      <AttendanceCalendar
        calendar={calendar}
        basePath="/parent/attendance"
        childId={children.length > 1 ? selected.studentProfileId : null}
        childName={selected.name}
      />

      {records.some((record) => record.notes !== null && record.notes !== '') ? (
        <Card
          header={
            <CardTitle
              title="Notes from the register"
              description="What the teacher wrote against a day. Only days carrying a note appear here."
            />
          }
          className="p-0"
        >
          <ul className="divide-y divide-line">
            {records
              .filter((record) => record.notes !== null && record.notes !== '')
              .map((record) => (
                <li key={record.date} className="px-5 py-3">
                  <p className="text-sm font-medium text-ink">{record.date}</p>
                  <p className="text-sm text-ink-muted">{record.notes}</p>
                </li>
              ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

function Heading() {
  return (
    <PageHeader
      title="Attendance"
      description="Your children&rsquo;s attendance month by month, as recorded by their teachers. Late counts as present; school holidays are excluded from the percentage."
    />
  );
}

function SummaryCard({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
        {label}
      </p>
      <p
        className={
          emphasis
            ? 'mt-2 text-2xl font-bold text-status-danger-ink'
            : 'mt-2 text-2xl font-bold text-ink'
        }
      >
        {value}
      </p>
    </Card>
  );
}
