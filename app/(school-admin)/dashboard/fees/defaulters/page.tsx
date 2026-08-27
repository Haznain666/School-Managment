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
import { listAdmissionsBranches, listGrades } from '@/lib/admissions-queries';
import {
  AGING_BUCKETS,
  BUCKET_LABELS,
  isAgingBucket,
  listDefaulters,
} from '@/lib/defaulters';
import { gradeLabels } from '@/lib/class-labels';
import { formatDateOnly } from '@/lib/dates';
import { formatPhoneForDisplay } from '@/lib/phone-formats';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Aged debt',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Aged debt, one row per student.
 *
 * ── How this differs from the Defaulters tab in Fee Reports ─────────────
 * That one (`/api/school/fees/reports/defaulters`) is a **chase list**: one row
 * per overdue *challan*, filtered by a days-overdue threshold, and it is what
 * the reminder sender works from. This is an **aged debt report**: one row per
 * *student*, every open challan folded together and split across buckets, which
 * is what `SPRINTS.md` asked for and what somebody answering "how much of our
 * receivable is over 90 days" needs. Two questions, two reports; neither
 * replaces the other.
 *
 * Server-rendered with the filters in the URL rather than a client component
 * with fetches: it is a read, an accountant links colleagues to a filtered view
 * of it, and it is the one report here somebody prints and carries to a desk.
 *
 * Guardian numbers are masked, following the decision already recorded on the
 * chase-list route. Full contact details are one click away on the student.
 */
export default async function DefaultersPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string; grade?: string; bucket?: string; min?: string }>;
}) {
  const { claims, locationId } = await requireSchoolPermission('fees.read');
  const filters = await searchParams;

  // A branch-scoped admin sees their own campus and cannot widen it.
  const branchId = claims.branchId ?? filters.branch;
  const bucket = isAgingBucket(filters.bucket) ? filters.bucket : undefined;
  const minimum = Number.parseFloat(filters.min ?? '');

  const [{ rows, summary }, branches, grades] = await Promise.all([
    listDefaulters(locationId, {
      branchId: branchId === '' ? undefined : branchId,
      gradeId: filters.grade === '' ? undefined : filters.grade,
      bucket,
      minimumAmount: Number.isFinite(minimum) ? minimum : undefined,
    }),
    listAdmissionsBranches(locationId),
    listGrades(locationId, claims.branchId ?? undefined),
  ]);

  // "Grade 5, Grade 5" is unreadable when a school runs one at each campus.
  // See `lib/class-labels.ts` — the rule is shared, not repeated here.
  const classNames = gradeLabels(grades, branches);

  const linkFor = (patch: Record<string, string | undefined>) => {
    const query = new URLSearchParams();
    const merged = { ...filters, ...patch };
    for (const [key, value] of Object.entries(merged)) {
      if (value !== undefined && value !== '') query.set(key, value);
    }
    const search = query.toString();
    return search === '' ? '/dashboard/fees/defaulters' : `/dashboard/fees/defaulters?${search}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-ink">Aged debt</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Everyone with money outstanding, aged from the date it fell due —
          worst first. To send reminders, use the Defaulters tab in{' '}
          <Link href="/dashboard/fees/reports" className="font-medium text-brand-primary hover:underline">
            Fee Reports
          </Link>
          .
        </p>
      </div>

      <Card header={<CardTitle title="Outstanding" description={`${summary.students} students · PKR ${summary.outstanding}`} />}>
        <div className="flex flex-wrap gap-2">
          {AGING_BUCKETS.map((key) => (
            <Link key={key} href={linkFor({ bucket: bucket === key ? undefined : key })}>
              <span
                className={
                  bucket === key
                    ? 'inline-flex flex-col rounded-lg border border-brand-primary px-3 py-2'
                    : 'inline-flex flex-col rounded-lg border border-line px-3 py-2 hover:border-line-strong'
                }
              >
                <span className="text-xs uppercase tracking-wide text-ink-muted">
                  {BUCKET_LABELS[key]}
                </span>
                <span className="mt-0.5 font-mono text-sm text-ink">
                  PKR {summary.buckets[key]}
                </span>
              </span>
            </Link>
          ))}
        </div>

        {summary.unreachable > 0 ? (
          <p className="mt-4 text-sm text-status-warning-onSubtle">
            {summary.unreachable} of these households have no phone number and
            no email address on file — nobody can be chased about them until a
            contact is recorded.
          </p>
        ) : null}

        {bucket !== undefined || filters.grade !== undefined || filters.branch !== undefined ? (
          <p className="mt-4 text-sm">
            <Link href="/dashboard/fees/defaulters" className="font-medium text-brand-primary hover:underline">
              Clear filters
            </Link>
          </p>
        ) : null}
      </Card>

      {claims.branchId === null && branches.length > 1 ? (
        <div className="flex flex-wrap gap-2 text-sm">
          <Link
            href={linkFor({ branch: undefined })}
            className={filters.branch === undefined ? 'font-semibold text-brand-primary' : 'text-ink-muted hover:underline'}
          >
            All campuses
          </Link>
          {branches.map((branch) => (
            <Link
              key={branch.id}
              href={linkFor({ branch: branch.id })}
              className={filters.branch === branch.id ? 'font-semibold text-brand-primary' : 'text-ink-muted hover:underline'}
            >
              {branch.name}
            </Link>
          ))}
        </div>
      ) : null}

      {grades.length > 0 ? (
        <div className="flex flex-wrap gap-2 text-sm">
          <Link
            href={linkFor({ grade: undefined })}
            className={filters.grade === undefined ? 'font-semibold text-brand-primary' : 'text-ink-muted hover:underline'}
          >
            All classes
          </Link>
          {grades.map((grade) => (
            <Link
              key={grade.id}
              href={linkFor({ grade: grade.id })}
              className={filters.grade === grade.id ? 'font-semibold text-brand-primary' : 'text-ink-muted hover:underline'}
            >
              {classNames.get(grade.id) ?? grade.label}
            </Link>
          ))}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-muted">
            Nothing outstanding under those filters.
          </p>
        </Card>
      ) : (
        <Card className="p-0">
          <Table caption="Students with money outstanding">
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Student</TableHeaderCell>
                  <TableHeaderCell>Class</TableHeaderCell>
                  <TableHeaderCell>Contact</TableHeaderCell>
                  <TableHeaderCell>Oldest due</TableHeaderCell>
                  <TableHeaderCell>Age</TableHeaderCell>
                  <TableHeaderCell align="numeric">Outstanding</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.studentProfileId}>
                    <TableCell>
                      <Link
                        href={`/dashboard/admissions/students/${row.studentProfileId}`}
                        className="font-medium text-brand-primary hover:underline"
                      >
                        {row.studentName}
                      </Link>
                      <span className="block font-mono text-xs text-ink-muted">
                        {row.studentNumber}
                      </span>
                    </TableCell>
                    <TableCell muted>
                      {row.gradeName} {row.sectionName}
                      <span className="block text-xs text-ink-muted">{row.branchName}</span>
                    </TableCell>
                    <TableCell muted>
                      {row.reachable ? (
                        <>
                          <span className="block">{row.guardianName ?? '—'}</span>
                          <span className="block font-mono text-xs text-ink-muted">
                            {row.guardianPhone === null
                              ? row.guardianEmail
                              : formatPhoneForDisplay(row.guardianPhone)}
                          </span>
                        </>
                      ) : (
                        <span className="text-status-warning-ink">No contact on file</span>
                      )}
                    </TableCell>
                    <TableCell muted className="font-mono text-xs">
                      {formatDateOnly(row.oldestDueDate)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          row.bucket === 'd90_plus'
                            ? 'danger'
                            : row.bucket === 'current'
                              ? 'neutral'
                              : 'warning'
                        }
                      >
                        {BUCKET_LABELS[row.bucket]}
                      </Badge>
                      {row.openChallans > 1 ? (
                        <span className="mt-1 block text-xs text-ink-muted">
                          {row.openChallans} challans
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell align="numeric" className="font-mono">
                      {row.outstanding}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
