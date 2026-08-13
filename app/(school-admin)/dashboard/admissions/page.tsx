import type { Metadata } from 'next';
import Link from 'next/link';

import { Badge } from '@/components/ui/Badge';
import { Card, CardTitle } from '@/components/ui/Card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@/components/ui/Table';
import { getAdmissionsOverview } from '@/lib/admissions-queries';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Admissions',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function StatCard({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
        {label}
      </p>
      <p className="mt-2 text-3xl font-bold text-ink">{value}</p>
      <p className="mt-1 text-xs text-ink-muted">{hint}</p>
    </Card>
  );
}

function ActionTile({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-card border border-line bg-surface-raised p-4 shadow-card transition hover:border-brand-primary"
    >
      <p className="font-medium text-ink">{title}</p>
      <p className="mt-1 text-sm text-ink-muted">{description}</p>
    </Link>
  );
}

/**
 * Admissions overview.
 *
 * Every count is scoped to the caller's own school and to its active academic
 * year — the location id comes from their verified session, so there is no
 * request parameter that could widen it to another tenant.
 */
export default async function AdmissionsOverviewPage() {
  const { locationId } = await requireSchoolPermission('admissions.read');
  const overview = await getAdmissionsOverview(locationId);

  return (
    <div className="space-y-6">
      {overview.activeYear === null ? (
        <Card>
          <h2 className="text-base font-semibold text-ink">
            No active academic year
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            Students are enrolled into a year, and student IDs are numbered per
            year — so nothing can be admitted until one is set. This also keeps
            the public application form closed.
          </p>
          <Link
            href="/dashboard/admissions/academic-years/new"
            className="mt-4 inline-block text-sm font-medium text-brand-primary hover:underline"
          >
            Set up an academic year
          </Link>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Students this year"
          value={overview.studentsThisYear}
          hint={
            overview.activeYear === null
              ? 'No active academic year'
              : `Active enrolments in ${overview.activeYear.name}`
          }
        />
        <StatCard
          label="Pending applications"
          value={overview.pendingApplications}
          hint="Awaiting review"
        />
        <StatCard
          label="Sections with space"
          value={overview.sectionsWithSpace}
          hint="Below capacity, or uncapped"
        />
        <StatCard
          label="New this month"
          value={overview.newThisMonth}
          hint="Student records created"
        />
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
          Quick actions
        </h2>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <ActionTile
            href="/dashboard/admissions/enroll"
            title="Enrol a student"
            description="Add a student directly, without an application."
          />
          <ActionTile
            href="/dashboard/admissions/applications"
            title="Review applications"
            description="Accept, waitlist or reject what has come in from /apply."
          />
          <ActionTile
            href="/dashboard/admissions/academic-years"
            title="Set up academic year"
            description="Create a session and choose which one is current."
          />
        </div>
      </section>

      <Card
        header={
          <CardTitle
            title="Recent enrolments"
            description="The last ten students admitted this year."
            action={
              <Link
                href="/dashboard/admissions/students"
                className="text-sm font-medium text-brand-primary hover:underline"
              >
                All students
              </Link>
            }
          />
        }
        className="p-0"
      >
        {overview.recentEnrollments.length === 0 ? (
          <p className="px-5 py-4 text-sm text-ink-muted">
            No students have been enrolled yet.
          </p>
        ) : (
          <Table caption="Admissions by grade">
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Name</TableHeaderCell>
                  <TableHeaderCell>Student ID</TableHeaderCell>
                  <TableHeaderCell>Grade</TableHeaderCell>
                  <TableHeaderCell>Section</TableHeaderCell>
                  <TableHeaderCell>Enrolled</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {overview.recentEnrollments.map((student) => (
                  <TableRow key={student.studentProfileId}>
                    <TableCell rowHeader>
                      <Link
                        href={`/dashboard/admissions/students/${student.studentProfileId}`}
                        className="hover:underline"
                      >
                        {student.name}
                      </Link>
                    </TableCell>
                    <TableCell muted className="font-mono text-xs">
                      {student.studentId}
                    </TableCell>
                    <TableCell muted>{student.gradeName}</TableCell>
                    <TableCell muted>{student.sectionName}</TableCell>
                    <TableCell muted>{student.enrollmentDate}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
          </Table>
        )}
      </Card>

      <Card
        header={
          <CardTitle
            title="Pending applications"
            description="The five longest waiting."
            action={
              <Link
                href="/dashboard/admissions/applications"
                className="text-sm font-medium text-brand-primary hover:underline"
              >
                All applications
              </Link>
            }
          />
        }
      >
        {overview.pendingPreview.length === 0 ? (
          <p className="text-sm text-ink-muted">Nothing is waiting for review.</p>
        ) : (
          <ul className="divide-y divide-line">
            {overview.pendingPreview.map((application) => (
              <li
                key={application.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <p className="font-medium text-ink">{application.studentName}</p>
                  <p className="text-xs text-ink-muted">
                    {application.guardianName} ·{' '}
                    <span className="font-mono">{application.guardianPhone}</span> ·{' '}
                    {application.gradeName ?? 'Grade not specified'}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <Badge variant="neutral">
                    {application.submittedAt.toISOString().slice(0, 10)}
                  </Badge>
                  <Link
                    href={`/dashboard/admissions/applications/${application.id}`}
                    className="text-sm font-medium text-brand-primary hover:underline"
                  >
                    Review
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
