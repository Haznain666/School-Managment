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
import { getStudentFeeSummary } from '@/lib/fee-queries';
import { formatPkr } from '@/lib/money';
import { requireSchoolRole } from '@/lib/school-guard';
import { getModuleFlags, getSchoolUserByUid } from '@/lib/school-queries';

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

  const moduleFlags = await getModuleFlags(locationId);

  // Only read fees when the school bills through the platform.
  const feeSummary =
    selected === null || !moduleFlags.fee_management
      ? null
      : await getStudentFeeSummary(
          locationId,
          selected.studentProfileId,
          activeYear?.id ?? null,
        );

  return (
    <div className="space-y-6">
      <Card>
        <h2 className="text-lg font-semibold text-slate-900">
          Welcome{firstName === '' ? '' : `, ${firstName}`}.
        </h2>
        <p className="mt-1 text-sm text-slate-600">
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
                  ? 'rounded-full bg-brand-primary px-3 py-1.5 text-sm font-medium text-white'
                  : 'rounded-full bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-200'
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
        {moduleFlags.fee_management && feeSummary !== null && selected !== null ? (
          <Card
            header={
              <CardTitle
                title="Fee status"
                description={selected.name}
                action={
                  <Link
                    href={`/parent/fees?child=${selected.studentProfileId}`}
                    className="text-sm font-medium text-brand-primary hover:underline"
                  >
                    View all
                  </Link>
                }
              />
            }
          >
            <p
              className={`text-2xl font-bold ${
                feeSummary.outstandingPaise > 0 ? 'text-red-700' : 'text-slate-900'
              }`}
            >
              PKR {formatPkr(feeSummary.outstandingPaise)}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {feeSummary.outstandingPaise === 0
                ? 'Nothing outstanding.'
                : 'Outstanding balance.'}
            </p>

            {feeSummary.nextDue === null ? null : (
              <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                Next due <strong>{feeSummary.nextDue.dueDate}</strong> · challan{' '}
                <span className="font-mono text-xs">
                  {feeSummary.nextDue.challanNumber}
                </span>{' '}
                · PKR {formatPkr(feeSummary.nextDue.balancePaise)}
              </p>
            )}
          </Card>
        ) : (
          <PlaceholderModuleCard
            icon="💳"
            title="Fee Status"
            moduleName="Fee Management"
            description="Invoices, due dates and payment history per child."
          />
        )}
        <PlaceholderModuleCard
          icon="✅"
          title="Attendance"
          moduleName="Academics"
          description="Daily attendance and absence notes."
        />
      </div>

      <Card header={<CardTitle title="Announcements" />}>
        <p className="text-sm text-slate-500">
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
              className="flex h-20 w-20 items-center justify-center rounded-xl bg-brand-primary text-xl font-bold text-white"
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
            <h3 className="text-lg font-semibold text-slate-900">{child.name}</h3>
            <Badge variant="neutral">
              <span className="font-mono">{child.studentId}</span>
            </Badge>
            <span className="text-xs text-slate-500">
              You are their{' '}
              {GUARDIAN_RELATIONSHIP_LABELS[child.relationship].toLowerCase()}
            </span>
          </div>

          {child.enrollment === null ? (
            <p className="mt-3 text-sm text-slate-500">
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
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-slate-900">{value}</dd>
    </div>
  );
}
