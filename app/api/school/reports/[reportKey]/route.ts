import { NextResponse, type NextRequest } from 'next/server';

import { resolveBranchScope } from '@/lib/branch-scope';
import { csvBody, csvFilename, csvHeaders } from '@/lib/csv-export';
import { hasPermission } from '@/lib/permission-queries';
import { isReportKey, parseReportParams, reportFor } from '@/lib/report-catalogue';
import { runReport } from '@/lib/report-queries';
import { readSchoolSession } from '@/lib/school-auth';

/**
 * GET /api/school/reports/[reportKey] — the report as a CSV download.
 *
 * `SPRINTS.md` §Sprint 12: "CSV export stays as specified: native `Response`
 * with `text/csv`." No dependency, and `lib/csv-export.ts` is the writer.
 *
 * ── Why this does not use `withSchoolAuth` ───────────────────────────────
 * That wrapper takes its permission at wrap time, and which of the nine
 * permissions this route needs is not known until the path parameter is read.
 * So the two things it does are done here explicitly and in the same order:
 * verify the session (which is where deactivation and tenancy are enforced —
 * `readSchoolSession` is the memoised call every guard in the app goes
 * through), then resolve the report's own permission against *this* school's
 * matrix. Nothing is skipped; only the packaging differs.
 *
 * ── The file is the table ────────────────────────────────────────────────
 * Same runner, same parsed parameters, same column list as the screen and the
 * sheet. The only difference is that values are written raw rather than
 * formatted, so a spreadsheet can add up a column of rupees — see
 * `lib/csv-export.ts`.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ reportKey: string }> },
): Promise<NextResponse> {
  const { reportKey } = await context.params;

  if (!isReportKey(reportKey)) {
    return NextResponse.json(
      { ok: false, error: { code: 'not_found', message: 'No such report.' } },
      { status: 404 },
    );
  }

  const definition = reportFor(reportKey);

  const claims = await readSchoolSession();
  if (claims === null) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'unauthenticated',
          message: 'Your session has expired. Sign in again.',
        },
      },
      { status: 401 },
    );
  }

  const permitted = await hasPermission(
    // Tenant from verified claims, never from the request.
    claims.locationId,
    claims.role,
    definition.permission,
  );

  if (!permitted) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: 'forbidden', message: 'Your role does not permit this action.' },
      },
      { status: 403 },
    );
  }

  const search: Record<string, string | undefined> = {};
  for (const [key, value] of new URL(request.url).searchParams.entries()) {
    // First value wins, matching the page's own reading of a repeated key.
    search[key] ??= value;
  }

  const requested = parseReportParams(definition, search);

  /*
   * The campus, resolved the same way the screen and the printed sheet resolve
   * it — same function, same fallback (Sprint 19a, item 9).
   *
   * This is the export, and it is the one of the three a reader takes away and
   * reconciles against a spreadsheet weeks later. A CSV holding a different
   * campus's figures from the table it was exported from is the defect the
   * report catalogue's whole one-definition-three-renderers design exists to
   * prevent, and the campus is the newest thing that could vary between them.
   */
  const branchScope = await resolveBranchScope(
    claims.locationId,
    claims,
    requested.branchId,
  );

  const params = {
    ...requested,
    branchId:
      branchScope.branchIds === null
        ? requested.branchId
        : (branchScope.selected ?? branchScope.branchIds[0]),
  };

  const result = await runReport(
    definition.key,
    {
      locationId: claims.locationId,
      sessionBranchId: null,
      branchIds: branchScope.branchIds,
    },
    params,
  );

  // The totals go in as a final row rather than being dropped: a spreadsheet
  // can recompute them, but the person who opens the file wants the same
  // bottom line the printout carried, and one that disagreed would be worse
  // than none.
  const rows = result.totals === null ? result.rows : [...result.rows, result.totals];

  return new NextResponse(csvBody(definition.columns, rows), {
    headers: csvHeaders(csvFilename(definition.title)),
  });
}
