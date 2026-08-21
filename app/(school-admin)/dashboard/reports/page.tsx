import type { Metadata } from 'next';
import Link from 'next/link';

import { Card, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { reportsFor, type ReportDefinition } from '@/lib/report-catalogue';
import { requireSchoolRole } from '@/lib/school-guard';
import { permissionsForRole } from '@/lib/permission-queries';
import { ADMIN_PORTAL_ROLES } from '@/types/school-auth';

export const metadata: Metadata = {
  title: 'Reports',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The reports index — Sprint 12.
 *
 * Gated on being a member of the administrative portal rather than on one
 * permission, because the nine reports carry nine different ones: an accountant
 * sees the money, a coordinator sees the classes, and neither sees the other's.
 * A page that required a single `reports.read` would have shown an accountant
 * the salary bill, and would have needed a migration in a sprint with none —
 * see `lib/report-catalogue.ts`.
 *
 * Somebody whose role holds none of the nine gets an empty state, not a 403:
 * they reached a page they may open which happens to have nothing on it for
 * them, and saying so is more useful than a bounce they will read as a bug.
 */
export default async function ReportsIndexPage() {
  const { claims, locationId } = await requireSchoolRole(ADMIN_PORTAL_ROLES);
  const permissions = await permissionsForRole(locationId, claims.role);

  const available = reportsFor(permissions);

  // Accounting last, deliberately. It is the group with the fewest people
  // holding its permission, so putting it above Fees would push the reports an
  // ordinary administrator actually opens below the fold on a phone.
  const groups: Array<ReportDefinition['group']> = [
    'Academics',
    'Fees',
    'People',
    'Accounting',
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Printable, exportable answers to the questions a school is asked in writing."
        breadcrumbs={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Reports' }]}
      />

      {available.length === 0 ? (
        <EmptyState
          title="No reports for your role"
          description="Each report is opened by the permission that governs the screen its data comes from. Ask a school administrator to grant you one of those, and the matching reports appear here."
        />
      ) : (
        groups.map((group) => {
          const inGroup = available.filter((report) => report.group === group);
          if (inGroup.length === 0) return null;

          return (
            <Card key={group} header={<CardTitle title={group} />}>
              <ul className="divide-y divide-line">
                {inGroup.map((report) => (
                  <li key={report.key}>
                    <Link
                      href={`/dashboard/reports/${report.key}`}
                      className="-mx-2 flex flex-col gap-0.5 rounded-lg px-2 py-3 hover:bg-surface-sunken"
                    >
                      <span className="font-medium text-brand-primary">{report.title}</span>
                      <span className="text-sm text-ink-muted">{report.blurb}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })
      )}
    </div>
  );
}
