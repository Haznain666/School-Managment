import { studentImportBatches, studentImportRows } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { withSchoolAuth } from '@/lib/api-auth';
import { CsvError, parseCsv } from '@/lib/csv';
import { db } from '@/lib/drizzle';
import { listImportBatches } from '@/lib/student-import-queries';
import { suggestColumnMap } from '@/lib/student-import';
import { readString } from '@/lib/validation';

/**
 * /api/school/student-imports
 *
 * GET  the school's recent import batches
 * POST start one — parse the file, keep every row, suggest a mapping
 *
 * ── The file arrives as text in a JSON body, not as multipart ────────────
 * The mapping screen has already parsed it in the browser to show a preview,
 * using `lib/csv.ts`, which is the same parser this route uses. Sending the
 * text it already holds means there is exactly one parse of record and the
 * preview cannot disagree with what gets stored. Multipart would add a second
 * decode path for no benefit — the file is a few hundred kilobytes of text.
 *
 * Nothing is validated here. Validation needs the column map, and the column
 * map needs a person. What POST does is make the upload durable so closing the
 * laptop does not lose it.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (_request, auth) => {
    try {
      return apiSuccess({ batches: await listImportBatches(auth.locationId) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'students.import' },
);

interface CreateBatchBody {
  fileName?: unknown;
  content?: unknown;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<CreateBatchBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const fileName = readString(body.fileName);
      const content = typeof body.content === 'string' ? body.content : '';

      if (fileName === '' || content === '') {
        return apiFailure('invalid_body', 'Choose a file to import.', 400);
      }

      let parsed;
      try {
        parsed = parseCsv(content);
      } catch (error) {
        if (error instanceof CsvError) {
          return apiFailure('invalid_body', error.message, 400);
        }
        throw error;
      }

      if (parsed.rows.length === 0) {
        return apiFailure(
          'invalid_body',
          'That file has a header row and no students under it.',
          400,
        );
      }

      const batchId = crypto.randomUUID();

      // One transaction: a batch whose rows are half-written would present as a
      // short file, and the operator would import it believing it was whole.
      await db.transaction(async (tx) => {
        await tx.insert(studentImportBatches).values({
          id: batchId,
          // Tenant from the verified session, never from the body.
          locationId: auth.locationId,
          fileName,
          sourceColumns: parsed.columns,
          totalRows: parsed.rows.length,
          uploadedByUid: auth.uid,
        });

        await tx.insert(studentImportRows).values(
          parsed.rows.map((row, index) => ({
            locationId: auth.locationId,
            batchId,
            // +2: the header is row 1 and the operator counts from there, so
            // "row 47" in the report is row 47 in their spreadsheet.
            rowNumber: index + 2,
            raw: row,
          })),
        );
      });

      return apiSuccess(
        {
          batchId,
          columns: parsed.columns,
          delimiter: parsed.delimiter,
          totalRows: parsed.rows.length,
          suggestedMap: suggestColumnMap(parsed.columns),
        },
        201,
      );
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'students.import' },
);
