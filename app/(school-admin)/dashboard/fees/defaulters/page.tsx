import type { Metadata } from 'next';
import Link from 'next/link';

import { AgedDebtTable } from '@/components/fees/AgedDebtTable';
import { Card, CardTitle } from '@/components/ui/Card';
import { PrincipalScopeNote } from '@/components/school/PrincipalScopeNote';
import { PageHeader } from '@/components/ui/PageHeader';
import { AGING_BUCKETS, BUCKET_LABELS, listDefaulters } from '@/lib/defaulters';
import { formatPkr } from '@/lib/money';
import { visibleScopeFor } from '@/lib/principal-visibility';
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
 * per overdue *voucher*, filtered by a days-overdue threshold. This is an
 * **aged debt report**: one row per *student*, every open voucher folded
 * together and split across buckets, which is what somebody answering "how much
 * of our receivable is over 90 days" needs. Two questions, two reports; neither
 * replaces the other.
 *
 * ── Why the filters moved out of the URL ─────────────────────────────────
 * They were links, and every one of them cost a server round trip on a page
 * whose rows were already all in memory — `listDefaulters` folds the school's
 * whole open debt in this process and says why in its own docblock. Sprint 18
 * moved the table onto `components/ui/DataTable` in client mode, so sorting by
 * any column and narrowing by age, campus, class or amount now costs nothing.
 *
 * The cost, stated plainly: a filtered view is no longer a link somebody can
 * send a colleague. That was worth losing for a report read by one person at a
 * desk, with a sortable header on every column they were previously stuck with
 * one ordering of.
 *
 * Guardian numbers are masked, following the decision already recorded on the
 * chase-list route. Full contact details are one click away on the student.
 */
export default async function DefaultersPage() {
  const { claims, locationId, permissions } =
    await requireSchoolPermission('fees.read');

  // A branch-scoped admin sees their own campus and cannot widen it. This is
  // the one narrowing that stays on the server: it is an authorisation
  // boundary, not a filter, and a control the reader may not clear.
  /*
   * BR4 — Sprint 23, item 3. A head's aged debt is their own classes', and the
   * bucket totals above the table are folded from exactly these rows: a head
   * shown their own students under the whole school's receivable would be
   * reading a number that is not theirs, with nothing on the screen saying so.
   */
  const visible = await visibleScopeFor({
    locationId,
    role: claims.role,
    uid: claims.uid,
  });

  const { rows, summary } = await listDefaulters(locationId, {
    branchId: claims.branchId ?? undefined,
    scopeGradeIds: visible.gradeIds,
  });

  return (
    <div className="space-y-6">
      {/*
        `PageHeader`, not a hand-rolled `<h2>` — Sprint 20, item 4d.

        This page wrote its own heading at `text-xl` inside an `<h2>`, while
        every other screen in the product renders `PageHeader`'s `<h1>` at
        `text-2xl`. Read against `/dashboard/fees/challans` or `/dashboard/users`
        at the same zoom it was visibly the smaller title, and the outlier was
        here rather than in the majority — which is also why the description
        paragraph sat at the full page width instead of `PageHeader`'s readable
        measure.
      */}
      <PageHeader
        title="Aged debt"
        description={
          <>
            Everyone with money outstanding, aged from the date it fell due.
            Chase a family or settle their vouchers from the row itself; the
            per-voucher chase list lives in{' '}
            <Link
              href="/dashboard/fees/reports"
              className="font-medium text-brand-primary hover:underline"
            >
              Fee Reports
            </Link>
            .
          </>
        }
      />

      <PrincipalScopeNote note={visible.note} />

      <Card
        header={
          <CardTitle
            title="Outstanding"
            description={`${summary.students} students · ${formatPkr(summary.outstanding)}`}
          />
        }
      >
        <div className="flex flex-wrap gap-2">
          {AGING_BUCKETS.map((key) => (
            <span
              key={key}
              className="inline-flex flex-col rounded-lg border border-line px-3 py-2"
            >
              <span className="text-xs uppercase tracking-wide text-ink-muted">
                {BUCKET_LABELS[key]}
              </span>
              <span className="mt-0.5 font-mono text-sm text-ink">
                {formatPkr(summary.buckets[key])}
              </span>
            </span>
          ))}
        </div>

        {summary.unreachable > 0 ? (
          <p className="mt-4 text-sm text-status-warning-onSubtle">
            {summary.unreachable} of these households have no phone number and
            no email address on file — nobody can be chased about them until a
            contact is recorded.
          </p>
        ) : null}
      </Card>

      <AgedDebtTable rows={rows} canCollect={permissions.includes('fees.write')} />
    </div>
  );
}
