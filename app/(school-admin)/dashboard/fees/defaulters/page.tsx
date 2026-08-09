import type { Metadata } from 'next';
import Link from 'next/link';

import { Badge } from '@/components/ui/Badge';
import { Card, CardTitle } from '@/components/ui/Card';
import { listAdmissionsBranches, listGrades } from '@/lib/admissions-queries';
import {
  AGING_BUCKETS,
  BUCKET_LABELS,
  isAgingBucket,
  listDefaulters,
} from '@/lib/defaulters';
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
        <h2 className="text-xl font-semibold text-slate-900">Aged debt</h2>
        <p className="mt-1 text-sm text-slate-500">
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
                    : 'inline-flex flex-col rounded-lg border border-slate-200 px-3 py-2 hover:border-slate-400'
                }
              >
                <span className="text-xs uppercase tracking-wide text-slate-500">
                  {BUCKET_LABELS[key]}
                </span>
                <span className="mt-0.5 font-mono text-sm text-slate-900">
                  PKR {summary.buckets[key]}
                </span>
              </span>
            </Link>
          ))}
        </div>

        {summary.unreachable > 0 ? (
          <p className="mt-4 text-sm text-amber-800">
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
            className={filters.branch === undefined ? 'font-semibold text-brand-primary' : 'text-slate-600 hover:underline'}
          >
            All campuses
          </Link>
          {branches.map((branch) => (
            <Link
              key={branch.id}
              href={linkFor({ branch: branch.id })}
              className={filters.branch === branch.id ? 'font-semibold text-brand-primary' : 'text-slate-600 hover:underline'}
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
            className={filters.grade === undefined ? 'font-semibold text-brand-primary' : 'text-slate-600 hover:underline'}
          >
            All classes
          </Link>
          {grades.map((grade) => {
            // A school with the same grade at two campuses has two rows here,
            // and "Grade 5, Grade 5" is unreadable. The campus disambiguates
            // them — but only when it has to, so a single-campus school is not
            // made to read its own name against every class.
            const duplicated =
              grades.filter((other) => other.label === grade.label).length > 1;
            const campus = branches.find((branch) => branch.id === grade.branchId);

            return (
              <Link
                key={grade.id}
                href={linkFor({ grade: grade.id })}
                className={filters.grade === grade.id ? 'font-semibold text-brand-primary' : 'text-slate-600 hover:underline'}
              >
                {duplicated && campus !== undefined
                  ? `${grade.label} (${campus.name})`
                  : grade.label}
              </Link>
            );
          })}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-600">
            Nothing outstanding under those filters.
          </p>
        </Card>
      ) : (
        <Card className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Student</th>
                  <th scope="col" className="px-4 py-3 font-medium">Class</th>
                  <th scope="col" className="px-4 py-3 font-medium">Contact</th>
                  <th scope="col" className="px-4 py-3 font-medium">Oldest due</th>
                  <th scope="col" className="px-4 py-3 font-medium">Age</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Outstanding</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.studentProfileId}>
                    <td className="px-4 py-3">
                      <Link
                        href={`/dashboard/admissions/students/${row.studentProfileId}`}
                        className="font-medium text-brand-primary hover:underline"
                      >
                        {row.studentName}
                      </Link>
                      <span className="block font-mono text-xs text-slate-500">
                        {row.studentNumber}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {row.gradeName} {row.sectionName}
                      <span className="block text-xs text-slate-400">{row.branchName}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {row.reachable ? (
                        <>
                          <span className="block">{row.guardianName ?? '—'}</span>
                          <span className="block font-mono text-xs text-slate-500">
                            {row.guardianPhone ?? row.guardianEmail}
                          </span>
                        </>
                      ) : (
                        <span className="text-amber-700">No contact on file</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">
                      {row.oldestDueDate}
                    </td>
                    <td className="px-4 py-3">
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
                        <span className="mt-1 block text-xs text-slate-500">
                          {row.openChallans} challans
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-900">
                      {row.outstanding}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
