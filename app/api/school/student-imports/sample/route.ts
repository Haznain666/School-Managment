import { NextResponse } from 'next/server';

import { withSchoolAuth } from '@/lib/api-auth';
import { sampleSheetCsv, sampleSheetHeaders } from '@/lib/student-import-sample';

/**
 * GET /api/school/student-imports/sample — the blank sheet to fill in.
 *
 * ── Why a route rather than a file in `public/` ──────────────────────────
 * A static file would be a second copy of the column list, sitting outside the
 * type-checker and outside every check script, and it would be the copy that
 * went stale — nothing about editing `IMPORT_FIELDS` would draw anybody's eye
 * to it. Generated from the field list, the sample cannot describe a column
 * the importer does not have.
 *
 * It is also behind the school session for the same reason the importer is:
 * the file names no student and leaks nothing, but a `/public` URL is an
 * unauthenticated endpoint on a multi-tenant deployment, and the habit of
 * putting product surface there is the thing worth not starting.
 *
 * ── Same writer as every other download ──────────────────────────────────
 * `lib/csv-export.ts`, so the sample carries the UTF-8 BOM Excel needs and the
 * formula guard on the `+92…` phone number. A sample that opened as mojibake
 * would teach a school that this product cannot spell their children's names.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  () => new NextResponse(sampleSheetCsv(), { headers: sampleSheetHeaders() }),
  { permission: 'students.import' },
);
