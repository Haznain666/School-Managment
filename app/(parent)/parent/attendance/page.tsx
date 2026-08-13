import type { Metadata } from 'next';
import Link from 'next/link';

import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { Card, CardTitle } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import {
  ATTENDANCE_STATUS_LABELS,
  type AttendanceStatus,
} from '@/db/schema/attendance-records';
import { listStudentAttendance, summariseAttendance } from '@/lib/academics-queries';
import { getActiveAcademicYear, listChildrenForGuardian } from '@/lib/admissions-queries';
import { requireSchoolRole } from '@/lib/school-guard';
import { getSchoolUserByUid } from '@/lib/school-queries';

export const metadata: Metadata = {
  title: 'Attendance',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const STATUS_VARIANTS: Record<AttendanceStatus, BadgeVariant> = {
  present: 'success',
  absent: 'danger',
  late: 'warning',
  excused: 'neutral',
  holiday: 'neutral',
};

/** The window this page reports on: the last 30 days, ending today. */
function lastThirtyDays(): { from: string; to: string } {
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 29);

  const iso = (value: Date): string => value.toISOString().slice(0, 10);
  return { from: iso(start), to: iso(today) };
}

/**
 * A parent's view of their children's attendance.
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
  searchParams: Promise<{ child?: string }>;
}) {
  const { claims, locationId } = await requireSchoolRole(['parent']);
  const profile = await getSchoolUserByUid(locationId, claims.uid);

  const activeYear = await getActiveAcademicYear(locationId);
  const children =
    profile === null
      ? []
      : await listChildrenForGuardian(locationId, profile.id, activeYear?.id ?? null);

  const { child: requestedChild } = await searchParams;

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

  const range = lastThirtyDays();
  const records = await listStudentAttendance(
    locationId,
    selected.studentProfileId,
    range,
  );
  const summary = summariseAttendance(records);

  return (
    <div className="space-y-6">
      <Heading />

      {children.length > 1 ? (
        <nav aria-label="Children" className="flex flex-wrap gap-2">
          {children.map((child) => (
            <Link
              key={child.studentProfileId}
              href={`/parent/attendance?child=${child.studentProfileId}`}
              aria-current={
                child.studentProfileId === selected.studentProfileId ? 'page' : undefined
              }
              className={
                child.studentProfileId === selected.studentProfileId
                  ? 'rounded-full bg-brand-primary px-3 py-1.5 text-sm font-medium text-brand-onPrimary'
                  : 'rounded-full bg-surface-sunken px-3 py-1.5 text-sm font-medium text-ink-muted hover:bg-line'
              }
            >
              {child.name}
            </Link>
          ))}
        </nav>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Present" value={String(summary.present)} />
        <SummaryCard label="Absent" value={String(summary.absent)} emphasis={summary.absent > 0} />
        <SummaryCard label="Late" value={String(summary.late)} />
        <SummaryCard
          label="Attendance"
          value={`${summary.percentage.toFixed(1)}%`}
          emphasis={summary.percentage < 75 && records.length > 0}
        />
      </div>

      <Card
        header={
          <CardTitle
            title="Last 30 days"
            description={`${selected.name} · ${range.from} to ${range.to}. Late counts as present; school holidays are excluded from the percentage.`}
          />
        }
        className="p-0"
      >
        {records.length === 0 ? (
          <p className="px-5 py-4 text-sm text-ink-muted">
            No attendance has been recorded in the last 30 days.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {records.map((record) => (
              <li
                key={record.date}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
              >
                <div className="min-w-0">
                  <p className="font-medium text-ink">{record.date}</p>
                  {record.notes === null || record.notes === '' ? null : (
                    <p className="text-xs text-ink-muted">{record.notes}</p>
                  )}
                </div>
                <Badge variant={STATUS_VARIANTS[record.status]}>
                  {ATTENDANCE_STATUS_LABELS[record.status]}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Heading() {
  return (
    <PageHeader
      title="Attendance"
      description="Your children&rsquo;s attendance over the last month, as recorded by their teachers."
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
