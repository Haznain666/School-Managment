import { randomUUID } from 'node:crypto';

import {
  DOCUMENT_TYPE_EXTENSIONS,
  MAX_DOCUMENT_BYTES,
  MAX_STUDENT_DOCUMENTS,
  documentTitleProblem,
  studentDocuments,
} from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import {
  countStudentDocuments,
  getStudentDetail,
  listStudentDocuments,
} from '@/lib/admissions-queries';
import { effectiveBranchIds, resolveBranchScope } from '@/lib/branch-scope';
import { db } from '@/lib/drizzle';
import { declaredTypeMatches, sniffImageType } from '@/lib/image-signature';
import { buildStoragePath, uploadBuffer } from '@/lib/storage';
import { isUuid } from '@/lib/validation';

/**
 * /api/school/students/[studentId]/documents — a child's paperwork.
 *
 * GET  what is on file
 * POST add one, as multipart form data: `title` and `file`
 *
 * ── The type is decided by the bytes, not by the browser ────────────────
 * A multipart part carries whatever media type the browser guessed *from the
 * file name*, so `payload.exe` renamed `bform.png` arrives as `image/png` and
 * would pass every check a header-only route can make. `sniffImageType` reads
 * the file's own signature; the declared type has to agree with it; and what is
 * stored is the sniffed answer, so a browser's `image/jpg` — which is not a
 * media type — never reaches the column.
 *
 * Refusing on the *disagreement* as well as on the sniff is not belt-and-
 * braces. A genuine JPEG uploaded through a field promising PNGs is a file the
 * operator did not mean to send, and silently accepting it is how a school ends
 * up with a birth certificate filed as something else.
 *
 * ── Why the upload runs through the server ──────────────────────────────
 * The same reason the photo and the logo do: the object path is decided here
 * from verified claims rather than trusted from the client, so a document can
 * only ever land inside its own school's prefix. The Supabase service-role key
 * never leaves the server, so no browser can write to Storage at all.
 *
 * ── Order of operations, and what a failure leaves behind ───────────────
 * Storage first, row second. The reverse would leave a row pointing at an
 * object that does not exist — a chip on the profile that opens a 404, which
 * nobody can distinguish from a deleted file. This way a failed insert leaves
 * an orphaned object: invisible, costing a few kilobytes, and referenced by
 * nothing. That is the cheaper of the two failures.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ studentId: string }> };

/**
 * The student, or the reason there is nothing to answer with.
 *
 * ── 404 rather than 403, and it is deliberate ───────────────────────────
 * A caller outside this child's campus is told the student does not exist,
 * because "you may not see this student" confirms that a student with that id
 * *does* exist at this school — which is the fact the boundary is there to
 * withhold. The student profile page has answered this way since Sprint 4.
 */
async function studentInScope(
  locationId: string,
  auth: { uid: string; branchId: string | null },
  studentId: string,
): Promise<{ studentProfileId: string; branchId: string | null } | null> {
  const student = await getStudentDetail(locationId, studentId);
  if (student === null) return null;

  const scope = await resolveBranchScope(locationId, auth);
  const reachable = effectiveBranchIds(scope);

  if (
    reachable !== null &&
    student.branchId !== null &&
    !reachable.includes(student.branchId)
  ) {
    return null;
  }

  return { studentProfileId: student.studentProfileId, branchId: student.branchId };
}

export const GET = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { studentId } = await context.params;
      if (!isUuid(studentId)) return apiFailure('not_found', 'Student not found.', 404);

      const student = await studentInScope(auth.locationId, auth, studentId);
      if (student === null) return apiFailure('not_found', 'Student not found.', 404);

      return apiSuccess({
        documents: await listStudentDocuments(auth.locationId, studentId),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'students.read' },
);

export const POST = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { studentId } = await context.params;
      if (!isUuid(studentId)) return apiFailure('not_found', 'Student not found.', 404);

      const student = await studentInScope(auth.locationId, auth, studentId);
      if (student === null) return apiFailure('not_found', 'Student not found.', 404);

      const form = await request.formData();
      const file = form.get('file');
      const title = String(form.get('title') ?? '');

      const titleProblem = documentTitleProblem(title);
      if (titleProblem !== null) {
        return apiFailure('invalid_body', titleProblem, 400);
      }

      if (!(file instanceof File)) {
        return apiFailure('invalid_body', 'Attach an image as "file".', 400);
      }
      if (file.size === 0) {
        return apiFailure('invalid_body', 'That file is empty.', 400);
      }
      if (file.size > MAX_DOCUMENT_BYTES) {
        return apiFailure(
          'file_too_large',
          'Each document must be 5 MB or smaller. Photograph it again at a lower resolution, or scan it as a JPG.',
          413,
        );
      }

      /*
       * The ceiling is checked before the upload, not after.
       *
       * Two clerks adding the eleventh document at the same moment can both
       * pass this — there is no constraint that could decide it, and inventing
       * one would mean a partial unique index counting rows, which Postgres
       * cannot express. The consequence of losing that race is a student with
       * eleven documents, which is a cosmetic overrun rather than a fault; the
       * consequence of checking *after* the upload is an orphaned object every
       * time somebody hits the limit.
       */
      const held = await countStudentDocuments(auth.locationId, studentId);
      if (held >= MAX_STUDENT_DOCUMENTS) {
        return apiFailure(
          'limit_reached',
          `This student already has ${MAX_STUDENT_DOCUMENTS} documents. Remove one before adding another.`,
          409,
        );
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const sniffed = sniffImageType(buffer);

      if (sniffed === null) {
        return apiFailure(
          'unsupported_type',
          'That file is not a PNG or JPG image. Photograph or scan the document and upload the picture.',
          415,
        );
      }
      if (!declaredTypeMatches(file.type, sniffed)) {
        return apiFailure(
          'unsupported_type',
          `That file is named as ${file.type || 'an unknown type'} but is actually ${sniffed}. Rename it or export it again.`,
          415,
        );
      }

      const extension = DOCUMENT_TYPE_EXTENSIONS[sniffed] ?? 'img';

      /*
       * `buildStoragePath`, which is the convention `lib/storage.ts` documents:
       * `{locationId}/{branchId}/{type}/{filename}`, with `_school` standing in
       * for a child who has no campus — one whose placement has not been made
       * yet, which is exactly the case the enrollment wizard uploads under.
       *
       * A fresh uuid per file rather than the title. A title is the school's own
       * words, it can contain a slash, and two documents may share one; a path
       * built from it would collide, and `x-upsert` would then overwrite the
       * first document with the second and report success.
       */
      const storagePath = buildStoragePath({
        locationId: auth.locationId,
        branchId: student.branchId,
        type: `student-documents/${studentId}`,
        filename: `${randomUUID()}.${extension}`,
      });

      const uploaded = await uploadBuffer({
        storagePath,
        buffer,
        contentType: sniffed,
      });

      const inserted = await db
        .insert(studentDocuments)
        .values({
          // Tenant comes from the verified session, never from the body.
          locationId: auth.locationId,
          studentProfileId: studentId,
          title: title.trim(),
          storagePath: uploaded.storagePath,
          downloadUrl: uploaded.downloadUrl,
          // The bytes' answer, not the browser's. See the docblock.
          contentType: sniffed,
          sizeBytes: file.size,
          uploadedByUid: auth.uid,
        })
        .returning({ id: studentDocuments.id });

      const created = inserted[0];
      if (created === undefined) {
        return apiFailure('write_failed', 'Could not save that document.', 500);
      }

      return apiSuccess(
        { document: { id: created.id, title: title.trim(), downloadUrl: uploaded.downloadUrl } },
        201,
      );
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'students.update' },
);
