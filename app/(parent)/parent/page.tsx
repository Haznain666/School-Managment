import type { Metadata } from 'next';
import Link from 'next/link';
import { Banknote, ClipboardCheck, Users } from 'lucide-react';

import { ChildDashboardCard } from '@/components/parent/ChildDashboardCard';
import { DashboardNotices } from '@/components/school/DashboardNotices';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatTile, StatTileGrid } from '@/components/ui/StatTile';
import { getActiveAcademicYear, listChildrenForGuardian } from '@/lib/admissions-queries';
import { listNoticesFor } from '@/lib/announcement-queries';
import { settle } from '@/lib/dashboard-queries';
import { getStudentFeeSummary } from '@/lib/fee-queries';
import { formatPkr, toPaise } from '@/lib/money';
import { getChildSnapshot } from '@/lib/portal-dashboard';
import { requireSchoolRole } from '@/lib/school-guard';
import { getSchoolUserByUid } from '@/lib/school-queries';

export const metadata: Metadata = {
  title: 'Parent dashboard',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The parent's dashboard.
 *
 * **Decision it informs:** is my child fine, and do I owe anything.
 *
 * ── One card per child ───────────────────────────────────────────────────
 * The previous version selected one child with `?child=` and showed the others
 * as chips. A parent of three answered "is everyone fine" by loading the page
 * three times, and anything wrong with the two they did not click on — a
 * missed register, an overdue challan — never appeared at all. The cards stack
 * now, and the query parameter is gone: it selected among children this page
 * already had in hand, so nothing was gained by round-tripping for it.
 *
 * ── Children are reached one way only ────────────────────────────────────
 * Through `student_guardians.school_user_id`, the link made when a guardian's
 * record matches a portal account. It is the only route from a parent to a
 * student, so a parent cannot reach a child they are not recorded against, and
 * there is no id in the URL that could be edited into somebody else's.
 *
 * ── Published results only ───────────────────────────────────────────────
 * Every result on this screen comes through `getChildSnapshot`, whose only
 * routes to a mark are `listPublishedTermsForStudent` and
 * `listStudentResultHistory`. An unpublished result reaching a parent is a
 * defect with consequences.
 *
 * ── Failure isolation ────────────────────────────────────────────────────
 * Each child's four reads are settled independently, so a fee module having a
 * bad morning costs one panel on one card rather than the whole page.
 */
export default async function ParentDashboardPage() {
  const { claims, locationId } = await requireSchoolRole(['parent']);

  const [profile, activeYear] = await Promise.all([
    getSchoolUserByUid(locationId, claims.uid),
    getActiveAcademicYear(locationId),
  ]);

  const firstName = (profile?.name ?? '').split(' ')[0] ?? '';

  const children =
    profile === null
      ? []
      : await listChildrenForGuardian(locationId, profile.id, activeYear?.id ?? null);

  const cards = await Promise.all(
    children.map(async (child) => {
      const [snapshot, fees] = await Promise.all([
        settle(`child snapshot ${child.studentProfileId}`, locationId, () =>
          getChildSnapshot(locationId, child.studentProfileId, activeYear?.id ?? null),
        ),
        settle(`child fees ${child.studentProfileId}`, locationId, () =>
          getStudentFeeSummary(locationId, child.studentProfileId),
        ),
      ]);

      return { child, snapshot, fees };
    }),
  );

  const notices =
    profile === null
      ? null
      : await settle('notices', locationId, () => listNoticesFor(locationId, profile.id, 10));

  // The household total. A parent asking "what do I owe" means all of it, and
  // any child whose read failed is left out of the sum *and* said so beneath
  // it — a total quietly missing one child is a bill that arrives as a shock.
  const readable = cards.filter((entry) => entry.fees !== null);
  const unreadable = cards.length - readable.length;
  const totalPaise = readable.reduce(
    (sum, entry) => sum + toPaise(entry.fees!.balance),
    0,
  );

  const rates = cards
    .map((entry) => entry.snapshot?.attendance.percentage)
    .filter((value): value is number => value !== undefined);
  const worst = rates.length === 0 ? null : Math.min(...rates);

  return (
    <div className="space-y-6">
      <Card>
        <h2 className="text-lg font-semibold text-ink">
          Welcome{firstName === '' ? '' : `, ${firstName}`}.
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          {children.length === 0
            ? 'Your children will appear here once they are enrolled by your school admin.'
            : `You are recorded as a guardian for ${children.length} student${
                children.length === 1 ? '' : 's'
              } at this school.`}
        </p>
      </Card>

      {children.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No children on your account yet"
          description="Your school links a child to your account when it records you as their guardian. Ask the office if this looks wrong."
        />
      ) : (
        <>
          <StatTileGrid>
            <StatTile
              label="Children"
              icon={Users}
              value={children.length.toLocaleString()}
              detail={activeYear === null ? 'No academic year is open' : activeYear.name}
            />

            <StatTile
              label="Total outstanding"
              icon={Banknote}
              value={unreadable === cards.length ? undefined : formatPkr(totalPaise / 100)}
              unavailable={
                unreadable === cards.length ? 'The fee figures could not be read.' : undefined
              }
              deltaMeaning={totalPaise > 0 ? 'bad' : 'good'}
              delta={totalPaise > 0 ? 'Payment due' : 'All settled'}
              detail={
                unreadable === 0
                  ? 'Across every child'
                  : `${unreadable} child${unreadable === 1 ? '' : 'ren'} could not be read`
              }
            />

            <StatTile
              label="Lowest attendance"
              icon={ClipboardCheck}
              value={worst === null ? undefined : `${worst}%`}
              unavailable={worst === null ? 'No register taken yet this month.' : undefined}
              deltaMeaning={worst !== null && worst < 85 ? 'bad' : 'good'}
              delta={worst === null ? undefined : worst < 85 ? 'Below 85%' : 'Healthy'}
              detail="This month, of your children"
            />
          </StatTileGrid>

          <div className="space-y-4">
            {cards.map((entry) => (
              <ChildDashboardCard
                key={entry.child.studentProfileId}
                child={entry.child}
                snapshot={entry.snapshot}
                fees={entry.fees}
                noActiveYear={activeYear === null}
              />
            ))}
          </div>

          <p className="text-sm text-ink-muted">
            Fees cannot be paid through this portal.{' '}
            <Link href="/parent/fees" className="font-medium text-brand-primary hover:underline">
              See every challan
            </Link>{' '}
            and take the number to your school office.
          </p>
        </>
      )}

      <DashboardNotices
        notices={notices ?? []}
        href="/parent/announcements"
        emptyMessage="Nothing yet. Notices your school sends to families will appear here."
      />
    </div>
  );
}
