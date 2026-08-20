import type { Metadata } from 'next';
import Link from 'next/link';

import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { relationshipLabel } from '@/db/schema';
import { summariseAttendance, listStudentAttendance } from '@/lib/academics-queries';
import {
  getActiveAcademicYear,
  listChildrenForGuardian,
  type ChildSummary,
} from '@/lib/admissions-queries';
import { monthBounds } from '@/lib/attendance-calendar';
import { getStudentFeeSummary } from '@/lib/fee-queries';
import { formatPkr, toPaise } from '@/lib/money';
import { requireSchoolRole } from '@/lib/school-guard';
import { getSchoolUserByUid } from '@/lib/school-queries';

export const metadata: Metadata = {
  title: 'My children',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Every child this parent is recorded against, one card each.
 *
 * ── Why this exists beside the dashboard ─────────────────────────────────
 * The dashboard shows the *selected* child and totals the household's fees.
 * That is the right shape for one child and the wrong one for four: a parent
 * with four children at a school wants them side by side, and switching between
 * them one at a time to answer "who is behind on attendance" is the thing this
 * page removes. The nav entry has been a placeholder since Sprint 4.
 *
 * ── One card is a whole child, and links onward ──────────────────────────
 * Class, campus, roll number, this month's attendance and what is owed — then
 * a link into each of the three screens that go deeper. It deliberately does
 * not try to *be* those screens.
 */
export default async function ParentChildrenPage() {
  const { claims, locationId } = await requireSchoolRole(['parent']);
  const profile = await getSchoolUserByUid(locationId, claims.uid);

  const activeYear = await getActiveAcademicYear(locationId);
  const children =
    profile === null
      ? []
      : await listChildrenForGuardian(locationId, profile.id, activeYear?.id ?? null);

  const today = new Date().toISOString().slice(0, 10);
  const thisMonth = monthBounds(
    Number.parseInt(today.slice(0, 4), 10),
    Number.parseInt(today.slice(5, 7), 10),
  );

  // One round trip per child for each of the two figures. A family is a handful
  // of children, so this is a small fixed cost — unlike the admin-side lists,
  // where the same shape would be the per-row round trip Sprint 10 removed
  // three times over.
  const details = await Promise.all(
    children.map(async (child) => ({
      child,
      fees: await getStudentFeeSummary(locationId, child.studentProfileId),
      attendance: summariseAttendance(
        await listStudentAttendance(locationId, child.studentProfileId, thisMonth),
      ),
    })),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="My children"
        description="Everyone you are recorded as a guardian for at this school."
      />

      {details.length === 0 ? (
        <EmptyState
          title="No children are linked to your account"
          description="Your school admin links a parent to a child’s record. Ask the school office to add you as a guardian."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {details.map(({ child, fees, attendance }) => (
            <ChildCard
              key={child.studentProfileId}
              child={child}
              balance={fees.balance}
              attendancePercentage={attendance.percentage}
              attendanceRecorded={
                attendance.present + attendance.absent + attendance.late + attendance.excused
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Initials for the avatar shown when a child has no photo on file. */
function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter((part) => part !== '')
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

function ChildCard({
  child,
  balance,
  attendancePercentage,
  attendanceRecorded,
}: {
  child: ChildSummary;
  balance: string;
  attendancePercentage: number;
  attendanceRecorded: number;
}) {
  const owes = toPaise(balance) > 0;

  return (
    <Card>
      <div className="flex gap-4">
        <div className="shrink-0">
          {child.photoUrl === null || child.photoUrl === '' ? (
            <span
              aria-hidden="true"
              className="flex h-14 w-14 items-center justify-center rounded-xl bg-brand-primary text-lg font-bold text-brand-onPrimary"
            >
              {initialsOf(child.name)}
            </span>
          ) : (
            // Photo dimensions vary per upload; a plain <img> avoids forcing one.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={child.photoUrl}
              alt={child.name}
              className="h-14 w-14 rounded-xl object-cover"
            />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-ink">{child.name}</h3>
            <Badge variant="neutral">
              <span className="font-mono">{child.studentId}</span>
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-ink-muted">
            {/* Not the bare enum: a guardian recorded as "Other" reads "You
                are their other" without the school's own words. */}
            You are their {relationshipLabel(child).toLowerCase()}
          </p>

          {child.enrollment === null ? (
            <p className="mt-3 text-sm text-ink-muted">
              No class placement is recorded for the current academic year.
            </p>
          ) : (
            <p className="mt-3 text-sm text-ink">
              {child.enrollment.gradeName} {child.enrollment.sectionName}
              {child.enrollment.rollNumber === null
                ? ''
                : ` · Roll ${child.enrollment.rollNumber}`}
              {child.enrollment.branchName === null
                ? ''
                : ` · ${child.enrollment.branchName}`}
            </p>
          )}
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-4 rounded-lg bg-surface-sunken p-3">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
            This month&rsquo;s attendance
          </dt>
          <dd className="mt-1 text-lg font-semibold text-ink">
            {attendanceRecorded === 0 ? (
              <span className="text-sm font-normal text-ink-muted">
                Nothing recorded yet
              </span>
            ) : (
              `${attendancePercentage.toFixed(1)}%`
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
            Outstanding
          </dt>
          <dd
            className={
              owes
                ? 'mt-1 text-lg font-semibold text-status-danger-ink'
                : 'mt-1 text-lg font-semibold text-ink'
            }
          >
            {formatPkr(balance)}
          </dd>
        </div>
      </dl>

      <nav className="mt-4 flex flex-wrap gap-4">
        {[
          { label: 'Attendance', href: `/parent/attendance?child=${child.studentProfileId}` },
          { label: 'Fees', href: `/parent/fees?child=${child.studentProfileId}` },
          { label: 'Results', href: `/parent/results?child=${child.studentProfileId}` },
        ].map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="text-sm font-medium text-brand-primary hover:underline"
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </Card>
  );
}
