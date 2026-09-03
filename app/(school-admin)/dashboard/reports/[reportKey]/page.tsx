import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { ReportFilterBar } from '@/components/reports/ReportFilterBar';
import { ReportTable } from '@/components/reports/ReportTable';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { resolveBranchScope } from '@/lib/branch-scope';
import { permissionsForRole } from '@/lib/permission-queries';
import {
  isReportKey,
  parseReportParams,
  reportFor,
  toReportQuery,
} from '@/lib/report-catalogue';
import { loadReportOptions } from '@/lib/report-options';
import { visibleScopeFor } from '@/lib/principal-visibility';
import { runReport } from '@/lib/report-queries';
import { requireSchoolRole } from '@/lib/school-guard';
import { ADMIN_PORTAL_ROLES, ROLE_HOME_ROUTES } from '@/types/school-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const metadata: Metadata = {
  title: 'Report',
};

type Search = Record<string, string | string[] | undefined>;

/** The query string as flat strings — a repeated parameter takes its first value. */
function flatten(search: Search): Record<string, string | undefined> {
  const flat: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(search)) {
    flat[key] = Array.isArray(value) ? value[0] : value;
  }
  return flat;
}

/**
 * One report: filters, the table, and the two ways off the screen.
 *
 * Server-rendered with the filters in the URL, like `/dashboard/fees/defaulters`
 * and for the same reasons — it is a read, colleagues link each other to
 * filtered views of it, and it is printed. Print and Export are plain links
 * carrying the current query string, so the sheet and the file cannot be of a
 * different selection from the table above them.
 *
 * The permission is the report's own, checked here rather than by the layout:
 * the layout gates the portal, and which of the nine permissions this page
 * needs is not known until the path parameter is read.
 */
export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ reportKey: string }>;
  searchParams: Promise<Search>;
}) {
  const { reportKey } = await params;
  if (!isReportKey(reportKey)) notFound();

  const definition = reportFor(reportKey);

  const { claims, locationId } = await requireSchoolRole(ADMIN_PORTAL_ROLES);
  const permissions = await permissionsForRole(locationId, claims.role);

  if (!permissions.includes(definition.permission)) {
    redirect(ROLE_HOME_ROUTES[claims.role]);
  }

  const search = flatten(await searchParams);
  const requested = parseReportParams(definition, search);

  /*
   * The campus, resolved once and then used by everything (Sprint 19a, item 9).
   *
   * `appliedBranch` is what the runner filters on, what the filter bar shows
   * selected, what Print and Export carry in their query strings, and what the
   * printed sheet is captioned with. Deriving it once is the point: a sheet
   * whose header names a different campus from its figures is worse than one
   * with no header, and four separate derivations is four chances at that.
   *
   * For a caller who may read the whole school it is whatever the URL asked
   * for, or nothing. For a branch-bound one it is their selection when they
   * have several campuses and made one, and otherwise their own campus —
   * which is `branchIds[0]`, because `resolveBranchScope` builds that list with
   * the caller's own membership first.
   */
  const branchScope = await resolveBranchScope(locationId, claims, requested.branchId);

  const appliedBranch =
    branchScope.branchIds === null
      ? requested.branchId
      : (branchScope.selected ?? branchScope.branchIds[0]);

  const reportParams = { ...requested, branchId: appliedBranch };


  /*
   * BR4 — Sprint 23, item 3. The third boundary on this screen.
   *
   * It composes with the campus rather than replacing it: a head of the
   * O-Levels division viewing the Karachi campus gets O-Levels at Karachi, the
   * same intersection the dashboard performs. Only the runners that join
   * `grades` read it — the seven financial statements have no class dimension
   * and are left whole, which `ReportScope.gradeIds` says at length.
   */
  const visible = await visibleScopeFor({
    locationId,
    role: claims.role,
    uid: claims.uid,
  });

  const [options, result] = await Promise.all([
    loadReportOptions(definition, locationId, branchScope.branchIds, visible.gradeIds),
    runReport(
      definition.key,
      {
        locationId,
        sessionBranchId: null,
        branchIds: branchScope.branchIds,
        gradeIds: visible.gradeIds,
      },
      reportParams,
    ),
  ]);

  const query = toReportQuery(reportParams);
  const suffix = query === '' ? '' : `?${query}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title={definition.title}
        description={definition.blurb}
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Reports', href: '/dashboard/reports' },
          { label: definition.title },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/dashboard/reports/${definition.key}/print${suffix}`}
              target="_blank"
              className="inline-flex h-10 items-center rounded-lg border border-line px-4 text-sm font-medium text-ink hover:border-line-strong"
            >
              Print
            </Link>
            <Link
              href={`/api/school/reports/${definition.key}${suffix}`}
              className="inline-flex h-10 items-center rounded-lg border border-line px-4 text-sm font-medium text-ink hover:border-line-strong"
            >
              Export CSV
            </Link>
          </div>
        }
      />

      <ReportFilterBar
        definition={definition}
        params={reportParams}
        options={options}
        action={`/dashboard/reports/${definition.key}`}
      />

      {definition.caveat === undefined ? null : (
        <p className="rounded-lg border border-line bg-surface-sunken px-4 py-3 text-sm text-ink-muted">
          {definition.caveat}
        </p>
      )}

      <Card className="p-0">
        <ReportTable
          definition={definition}
          rows={result.rows}
          totals={result.totals}
        />
      </Card>
    </div>
  );
}
