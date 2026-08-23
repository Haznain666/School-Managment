import Link from 'next/link';

import { Sparkline } from '@/components/charts/Sparkline';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { PROMOTION_STATUS_LABELS, relationshipLabel } from '@/db/schema';
import type { ChildSummary } from '@/lib/admissions-queries';
import type { StudentFeeSummary } from '@/lib/fee-queries';
import { formatPkr, toPaise } from '@/lib/money';
import type { ChildSnapshot } from '@/lib/portal-dashboard';

const DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

export interface ChildDashboardCardProps {
  child: ChildSummary;
  /** Null when the read failed — the card says so rather than showing zeroes. */
  snapshot: ChildSnapshot | null;
  fees: StudentFeeSummary | null;
  noActiveYear: boolean;
}

/**
 * One child, whole.
 *
 * ── Why one card per child, and no selector ──────────────────────────────
 * The previous dashboard picked one child with `?child=` and showed the rest as
 * chips. A parent of three then answered "is everyone fine" by loading the page
 * three times, and the two children they did not click on were invisible — a
 * missed register or an overdue challan on either simply never appeared. The
 * cards stack instead, and on a phone (which is where this portal is read) that
 * is the same layout either way.
 *
 * ── Nothing here is a zero it cannot vouch for ───────────────────────────
 * Each of the four panels comes from a different module, and each can fail on
 * its own. A failed read renders as a sentence saying so. "0%" attendance for a
 * child who has not missed a day is worse than an error, because a parent has
 * no way to tell it from the truth.
 *
 * ── Published results only ───────────────────────────────────────────────
 * `snapshot.latestResult` comes from `listStudentResultHistory`, which is
 * `publishedOnly`. There is no other route to a mark on this card.
 */
export function ChildDashboardCard({
  child,
  snapshot,
  fees,
  noActiveYear,
}: ChildDashboardCardProps) {
  const balancePaise = fees === null ? 0 : toPaise(fees.balance);
  const attendance = snapshot?.attendance ?? null;
  const result = snapshot?.latestResult ?? null;

  return (
    <Card>
      <div className="flex flex-col gap-5 sm:flex-row">
        <div className="shrink-0">
          {child.photoUrl === null || child.photoUrl === '' ? (
            <span
              aria-hidden="true"
              className="flex h-16 w-16 items-center justify-center rounded-xl bg-brand-primary text-lg font-bold text-brand-onPrimary"
            >
              {initialsOf(child.name)}
            </span>
          ) : (
            // Photo dimensions vary per upload; a plain <img> avoids forcing one.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={child.photoUrl}
              alt={child.name}
              className="h-16 w-16 rounded-xl object-cover"
            />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-lg font-semibold text-ink">{child.name}</h3>
            <Badge variant="neutral">
              <span className="font-mono">{child.studentId}</span>
            </Badge>
            <span className="text-xs text-ink-muted">
              You are their {relationshipLabel(child).toLowerCase()}
            </span>
          </div>

          <p className="mt-1 text-sm text-ink-muted">
            {child.enrollment === null
              ? noActiveYear
                ? 'The school has not opened an academic year yet.'
                : 'No class placement is recorded for the current academic year.'
              : `${child.enrollment.gradeName} ${child.enrollment.sectionName} · ${child.enrollment.academicYearName}${
                  child.enrollment.rollNumber === null
                    ? ''
                    : ` · Roll ${child.enrollment.rollNumber}`
                }`}
          </p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {/* Attendance this month. */}
            <Panel
              label="Attendance this month"
              href={`/parent/attendance?child=${child.studentProfileId}`}
            >
              {snapshot === null ? (
                <Unavailable>Could not be read.</Unavailable>
              ) : attendance !== null && attendance.percentage === 0 && marked(attendance) === 0 ? (
                // Nothing marked yet is not 0%. At the start of a month those
                // are opposite statements and one of them is alarming.
                <p className="text-sm text-ink-muted">No register taken yet this month.</p>
              ) : (
                <>
                  <p className="text-2xl font-bold text-ink">{attendance!.percentage}%</p>
                  <p className="text-xs text-ink-muted">
                    {attendance!.present + attendance!.late} present of {marked(attendance!)}{' '}
                    marked
                  </p>
                  {snapshot.attendanceSeries.length < 2 ? null : (
                    <Sparkline
                      className="mt-2"
                      values={snapshot.attendanceSeries}
                      label={`Attendance day by day this month: ${attendance!.percentage}% present`}
                      markLast={false}
                    />
                  )}
                </>
              )}
            </Panel>

            {/* Fees. */}
            <Panel label="Fees due" href={`/parent/fees?child=${child.studentProfileId}`}>
              {fees === null ? (
                <Unavailable>Could not be read.</Unavailable>
              ) : balancePaise === 0 ? (
                <p className="text-sm text-status-success-ink">Nothing outstanding.</p>
              ) : (
                <>
                  <p className="text-2xl font-bold text-status-danger-ink">
                    {formatPkr(fees.balance)}
                  </p>
                  <p className="text-xs text-ink-muted">
                    {fees.oldestUnpaid === null
                      ? 'Across all challans'
                      : `Oldest ${fees.oldestUnpaid.challanNumber}, due ${fees.oldestUnpaid.dueDate}`}
                  </p>
                </>
              )}
            </Panel>

            {/* Latest published result. */}
            <Panel
              label="Latest result"
              href={`/parent/results?child=${child.studentProfileId}`}
            >
              {snapshot === null ? (
                <Unavailable>Could not be read.</Unavailable>
              ) : result === null ? (
                <p className="text-sm text-ink-muted">
                  No report card has been published yet.
                </p>
              ) : (
                <>
                  <p className="text-2xl font-bold text-ink">
                    {result.overallPercentage === null
                      ? (result.overallGradeLabel ?? '—')
                      : `${result.overallPercentage}%`}
                  </p>
                  <p className="text-xs text-ink-muted">
                    {result.termName} · {result.academicYearName}
                  </p>
                  {/* The word, not the colour. A badge nobody can see the hue
                      of still has to say which way the decision went. */}
                  <Badge
                    className="mt-1"
                    variant={result.finalStatus === 'promoted' ? 'success' : 'warning'}
                  >
                    {PROMOTION_STATUS_LABELS[result.finalStatus]}
                  </Badge>
                </>
              )}
            </Panel>

            {/* Next exam. */}
            <Panel label="Next exam" href={`/parent/results?child=${child.studentProfileId}`}>
              {snapshot === null ? (
                <Unavailable>Could not be read.</Unavailable>
              ) : snapshot.nextExam === null ? (
                <p className="text-sm text-ink-muted">Nothing on the datesheet.</p>
              ) : (
                <>
                  <p className="font-semibold text-ink">{snapshot.nextExam.title}</p>
                  <p className="text-xs text-ink-muted">
                    {DATE.format(new Date(`${snapshot.nextExam.examDate}T00:00:00`))} ·{' '}
                    {snapshot.nextExam.termName}
                  </p>
                </>
              )}
            </Panel>
          </div>
        </div>
      </div>
    </Card>
  );
}

/** Days that count toward a rate — the same definition `summariseAttendance` uses. */
function marked(summary: {
  present: number;
  absent: number;
  late: number;
  excused: number;
}): number {
  return summary.present + summary.absent + summary.late + summary.excused;
}

function Panel({
  label,
  href,
  children,
}: {
  label: string;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-control bg-surface-sunken p-3">
      <Link href={href} className="block">
        <p className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">
          {label}
        </p>
        <div className="mt-1">{children}</div>
      </Link>
    </div>
  );
}

function Unavailable({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-ink-faint">{children}</p>;
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
