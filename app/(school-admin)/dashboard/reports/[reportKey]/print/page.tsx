import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { ReportTable } from '@/components/reports/ReportTable';
import { PrintNow } from '@/components/print/PrintNow';
import { PrintDocument, PrintLetterhead, PrintSheet } from '@/components/print/PrintSheet';
import { Card, CardTitle } from '@/components/ui/Card';
import { resolveBranchScope } from '@/lib/branch-scope';
import { permissionsForRole } from '@/lib/permission-queries';
import {
  describeScope,
  isReportKey,
  parseReportParams,
  reportFor,
} from '@/lib/report-catalogue';
import { loadReportOptions, selectedNames } from '@/lib/report-options';
import { visibleScopeFor } from '@/lib/principal-visibility';
import { runReport } from '@/lib/report-queries';
import { requireSchoolRole } from '@/lib/school-guard';
import { getSchoolBranding } from '@/lib/school-tenant';
import { ADMIN_PORTAL_ROLES, ROLE_HOME_ROUTES } from '@/types/school-auth';

export const metadata: Metadata = {
  title: 'Print report',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Search = Record<string, string | string[] | undefined>;

function flatten(search: Search): Record<string, string | undefined> {
  const flat: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(search)) {
    flat[key] = Array.isArray(value) ? value[0] : value;
  }
  return flat;
}

/**
 * A report on paper.
 *
 * The browser's print dialog is the renderer — `ROADMAP.md` §2 Tier 1 #3, and
 * `SPRINTS.md` restates it for this sprint: Hostinger runs a plain Node process
 * where a headless Chromium is unreliable, so there is no `@react-pdf/renderer`
 * and no `jspdf` here. `PrintSheet` owns the page size and the letterhead.
 *
 * ── Three things printed here that are not on the screen ─────────────────
 * The school's letterhead, the filters written out as a sentence, and the
 * moment it was produced. A sheet of figures leaves the building; six months
 * later somebody finds it and has to know what was asked for and when, and a
 * printout that cannot say is the one that gets misread in a meeting. The
 * report's caveat prints too, for the same reason — a pass rate whose rule
 * about absentees is invisible is a number reported in good faith and wrong.
 *
 * The runner, the parameters and the columns are the screen's. Nothing about
 * what this shows is decided here.
 */
export default async function ReportPrintPage({
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

  // Printing discloses nothing a reader of the report cannot already see, so
  // it is the same permission — checked again because the client is not a gate.
  if (!permissions.includes(definition.permission)) {
    redirect(ROLE_HOME_ROUTES[claims.role]);
  }

  const search = flatten(await searchParams);
  const requested = parseReportParams(definition, search);

  // Resolved exactly as the screen resolves it — same function, same fallback —
  // so the sheet and the table it was printed from cannot be of two different
  // campuses. See the note on the screen for why this is derived once.
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

  const [branding, options, result] = await Promise.all([
    getSchoolBranding(locationId),
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

  const scope = describeScope(definition, reportParams, selectedNames(options, reportParams));

  const producedAt = new Date().toISOString().slice(0, 16).replace('T', ' ');

  return (
    <div className="space-y-4">
      <Card
        header={
          <CardTitle
            title={definition.title}
            description={`${result.rows.length} rows · ${scope}`}
            action={<PrintNow label="Print" />}
          />
        }
      >
        <p className="text-sm text-ink-muted">
          {result.rows.length === 0
            ? 'There is nothing to print under those filters. Widen them on the report and try again.'
            : 'The sheet below is what reaches the paper. Everything else on this page is hidden when printing.'}
        </p>
      </Card>

      <PrintSheet paper={definition.landscape === true ? 'a4-landscape' : 'a4'}>
        <PrintDocument>
          <PrintLetterhead
            logoUrl={branding?.logoUrl ?? null}
            schoolName={branding?.name ?? 'School'}
            right={
              <div className="text-[9px]">
                <p className="text-sm font-bold uppercase">{definition.title}</p>
                <p>Produced {producedAt}</p>
              </div>
            }
          />

          <p className="mb-1.5 mt-1 text-[9px] font-semibold uppercase tracking-wide">
            {scope}
          </p>

          <ReportTable
            definition={definition}
            rows={result.rows}
            totals={result.totals}
            variant="print"
          />

          {definition.caveat === undefined ? null : (
            <p className="mt-2 border-t border-black pt-1 text-[8px] leading-snug">
              {definition.caveat}
            </p>
          )}
        </PrintDocument>
      </PrintSheet>
    </div>
  );
}
