import type { Metadata } from 'next';
import Link from 'next/link';

import { PlaceholderModuleCard } from '@/components/school/PlaceholderModuleCard';
import { Badge } from '@/components/ui/Badge';
import { Card, CardTitle } from '@/components/ui/Card';
import { GUARDIAN_RELATIONSHIP_LABELS } from '@/db/schema';
import {
  getActiveAcademicYear,
  listChildrenForGuardian,
  type ChildSummary,
} from '@/lib/admissions-queries';
import { getStudentFeeSummary, type StudentFeeSummary } from '@/lib/fee-queries';
import { formatPkr, toPaise } from '@/lib/money';
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
 * Children are found through `student_guardians.school_user_id` — the link made
 * when a guardian's phone number matches a portal account. It is the only route
 * from a parent to a student, so a parent cannot reach a child they are not
 * recorded against, and the `?child=` parameter only ever selects among the
 * children this query already returned.
 */
export default async function ParentDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ child?: string }>;
}) {
  const { claims, locationId } = await requireSchoolRole(['parent']);
  const profile = await getSchoolUserByUid(locationId, claims.uid);

  const firstName = (profile?.name ?? '').split(' ')[0] ?? '';

  const activeYear = await getActiveAcademicYear(locationId);
  const children =
    profile === null
      ? []
      : await listChildrenForGuardian(locationId, profile.id, activeYear?.id ?? null);

  const { child: requested } = await searchParams;
  const selected =
    children.find((entry) => entry.studentProfileId === requested) ??
    children[0] ??
    null;

  // One summary per child rather than only the selected one: the fee card below
  // is about the household, and a parent asking "what do I owe" means all of it.
  const feeSummaries = new Map<string, StudentFeeSummary>(
    await Promise.all(
      children.map(
        async (child) =>
          [
            child.studentProfileId,
            await getStudentFeeSummary(locationId, child.studentProfileId),
          ] as const,
      ),
    ),
  );

  const totalBalancePaise = [...feeSummaries.values()].reduce(
    (sum, summary) => sum + toPaise(summary.balance),
    0,
  );

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

      {children.length > 1 ? (
        <nav aria-label="Children" className="flex flex-wrap gap-2">
          {children.map((child) => (
            <Link
              key={child.studentProfileId}
              href={`/parent?child=${child.studentProfileId}`}
              aria-current={
                child.studentProfileId === selected?.studentProfileId ? 'page' : undefined
              }
              className={
                child.studentProfileId === selected?.studentProfileId
                  ? 'rounded-full bg-brand-primary px-3 py-1.5 text-sm font-medium text-brand-onPrimary'
                  : 'rounded-full bg-surface-sunken px-3 py-1.5 text-sm font-medium text-ink-muted hover:bg-line'
              }
            >
              {child.name}
            </Link>
          ))}
        </nav>
      ) : null}

      {selected === null ? (
        <PlaceholderModuleCard
          icon="👧"
          title="My Children"
          moduleName="Admissions"
          description="Each child's class, branch and attendance."
        />
      ) : (
        <ChildCard child={selected} noActiveYear={activeYear === null} />
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card
          header={
            <CardTitle
              title="Fee status"
              description="What is outstanding, per child."
              action={
                <Link
                  href="/parent/fees"
                  className="text-sm font-medium text-brand-primary hover:underline"
                >
                  All fees
                </Link>
              }
            />
          }
        >
          {children.length === 0 ? (
            <p className="text-sm text-ink-muted">
              Fee details appear once your children are enrolled.
            </p>
          ) : (
            <>
              <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                Total outstanding
              </p>
              <p
                className={
                  totalBalancePaise > 0
                    ? 'mt-1 text-2xl font-bold text-status-danger-ink'
                    : 'mt-1 text-2xl font-bold text-ink'
                }
              >
                {formatPkr(totalBalancePaise / 100)}
              </p>

              <ul className="mt-4 divide-y divide-line">
                {children.map((child) => {
                  const summary = feeSummaries.get(child.studentProfileId);
                  const balance = summary?.balance ?? '0';
                  const oldest = summary?.oldestUnpaid ?? null;

                  return (
                    <li key={child.studentProfileId} className="py-2.5">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-sm font-medium text-ink">
                          {child.name}
                        </span>
                        <span className="text-sm text-ink">
                          {formatPkr(balance)}
                        </span>
                      </div>
                      {oldest === null ? (
                        <p className="text-xs text-status-success-ink">Nothing outstanding.</p>
                      ) : (
                        <p className="text-xs text-ink-muted">
                          Oldest unpaid:{' '}
                          <span className="font-mono">{oldest.challanNumber}</span>, due{' '}
                          {oldest.dueDate}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Card>

        <PlaceholderModuleCard
          icon="✅"
          title="Attendance"
          moduleName="Academics"
          description="Daily attendance and absence notes."
        />
      </div>

      <Card header={<CardTitle title="Announcements" />}>
        <p className="text-sm text-ink-muted">
          School announcements will appear here.
        </p>
      </Card>
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
  noActiveYear,
}: {
  child: ChildSummary;
  noActiveYear: boolean;
}) {
  return (
    <Card>
      <div className="flex flex-col gap-5 sm:flex-row">
        <div className="shrink-0">
          {child.photoUrl === null || child.photoUrl === '' ? (
            <span
              aria-hidden="true"
              className="flex h-20 w-20 items-center justify-center rounded-xl bg-brand-primary text-xl font-bold text-brand-onPrimary"
            >
              {initialsOf(child.name)}
            </span>
          ) : (
            // Photo dimensions vary per upload; a plain <img> avoids forcing one.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={child.photoUrl}
              alt={child.name}
              className="h-20 w-20 rounded-xl object-cover"
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
              You are their{' '}
              {GUARDIAN_RELATIONSHIP_LABELS[child.relationship].toLowerCase()}
            </span>
          </div>

          {child.enrollment === null ? (
            <p className="mt-3 text-sm text-ink-muted">
              {noActiveYear
                ? 'The school has not opened an academic year yet.'
                : 'No class placement is recorded for the current academic year.'}
            </p>
          ) : (
            <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Detail label="Grade" value={child.enrollment.gradeName} />
              <Detail label="Section" value={child.enrollment.sectionName} />
              <Detail label="Academic year" value={child.enrollment.academicYearName} />
              <Detail label="Roll number" value={child.enrollment.rollNumber ?? '—'} />
              {child.enrollment.branchName === null ? null : (
                <Detail label="Campus" value={child.enrollment.branchName} />
              )}
            </dl>
          )}
        </div>
      </div>
    </Card>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-ink">{value}</dd>
    </div>
  );
}
