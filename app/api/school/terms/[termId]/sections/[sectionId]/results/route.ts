import { and, eq } from 'drizzle-orm';

import { studentTermResults } from '@/db/schema';
import { isPromotionStatus, OVERRIDE_REASON_MIN } from '@/db/schema/student-term-results';
import { withSchoolAuth, type SchoolAuthContext } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import {
  computeSectionTermResults,
  getSectionTermResults,
  isClassTeacherOfSection,
  listResultSubcategories,
} from '@/lib/exam-queries';
import { hasPermission } from '@/lib/permission-queries';
import { getSchoolUserByUid } from '@/lib/school-queries';
import { staffIdForSchoolUser } from '@/lib/staff-self-queries';
import { isUuid, readString } from '@/lib/validation';

/**
 * /api/school/terms/[termId]/sections/[sectionId]/results
 *
 * GET   the class's term, judged — status, reasons, and the stored decision
 * POST  recompute and write it down
 * PATCH override one child's status, or set their overall descriptor
 *
 * ── Who may touch a promotion ────────────────────────────────────────────
 * A holder of `results.promotion`, or the member of staff named on
 * `sections.class_teacher_id`. Nobody else — including a subject teacher
 * timetabled to the section, who marks one paper and has no view of the child's
 * year. The class teacher's authority is checked *per section* rather than
 * granted by a role key, which is why `teacher` deliberately does not hold
 * `results.promotion`: a role key would hand every teacher in the school every
 * class in it.
 *
 * ── The reason is required, and it is checked here ───────────────────────
 * The database CHECK is the backstop. It is not the sentence a class teacher
 * reads, and a constraint violation surfacing as a 500 on the screen that asked
 * for the reason reads as the screen being broken.
 *
 * ── Setting the status back clears the override completely ───────────────
 * Reason, who set it and when. Half an override left behind is a comment on a
 * parent's portal explaining a decision that was reversed.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ termId: string; sectionId: string }> };

/** Whether this caller may decide promotions for this class. */
async function mayDecide(
  auth: SchoolAuthContext,
  sectionId: string,
): Promise<boolean> {
  if (await hasPermission(auth.locationId, auth.role, 'results.promotion')) return true;

  const actor = await getSchoolUserByUid(auth.locationId, auth.uid);
  if (actor === null) return false;

  // `sections.class_teacher_id` names an HR record, not a portal account. A
  // teacher whose staff record has not been entered yet is not a class teacher
  // of anything, which is the correct answer rather than an error.
  const staffId = await staffIdForSchoolUser(auth.locationId, actor.id);
  if (staffId === null) return false;

  return isClassTeacherOfSection(auth.locationId, staffId, sectionId);
}

export const GET = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { termId, sectionId } = await context.params;
      if (!isUuid(termId) || !isUuid(sectionId)) {
        return apiFailure('not_found', 'Term or class not found.', 404);
      }

      if (!(await mayDecide(auth, sectionId))) {
        return apiFailure(
          'forbidden',
          'Only this class’s class teacher, or somebody who may set promotions, can open its results.',
          403,
        );
      }

      const results = await getSectionTermResults(auth.locationId, termId, sectionId);
      if (results === null) return apiFailure('not_found', 'Term or class not found.', 404);

      return apiSuccess(results);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'exams.read' },
);

export const POST = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { termId, sectionId } = await context.params;
      if (!isUuid(termId) || !isUuid(sectionId)) {
        return apiFailure('not_found', 'Term or class not found.', 404);
      }

      if (!(await mayDecide(auth, sectionId))) {
        return apiFailure(
          'forbidden',
          'Only this class’s class teacher, or somebody who may set promotions, can compute its results.',
          403,
        );
      }

      const outcome = await computeSectionTermResults(auth.locationId, termId, sectionId);

      return apiSuccess({
        ...outcome,
        results: await getSectionTermResults(auth.locationId, termId, sectionId),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'exams.read' },
);

interface OverrideBody {
  studentProfileId?: unknown;
  finalStatus?: unknown;
  overrideReason?: unknown;
  overallSubcategoryId?: unknown;
}

export const PATCH = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { termId, sectionId } = await context.params;
      if (!isUuid(termId) || !isUuid(sectionId)) {
        return apiFailure('not_found', 'Term or class not found.', 404);
      }

      if (!(await mayDecide(auth, sectionId))) {
        return apiFailure(
          'forbidden',
          'Only this class’s class teacher, or somebody who may set promotions, can change a promotion.',
          403,
        );
      }

      const body = await readJsonBody<OverrideBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }
      if (!isUuid(body.studentProfileId)) {
        return apiFailure('invalid_body', 'Choose a student.', 400);
      }
      if (!isPromotionStatus(body.finalStatus)) {
        return apiFailure('invalid_body', 'The status is promoted or not promoted.', 400);
      }

      const sheet = await getSectionTermResults(auth.locationId, termId, sectionId);
      if (sheet === null) return apiFailure('not_found', 'Term or class not found.', 404);

      const entry = sheet.students.find(
        (row) => row.student.studentProfileId === body.studentProfileId,
      );
      if (entry === undefined) {
        return apiFailure('not_found', 'That student is not in this class.', 404);
      }

      // A class teacher may reach a child before anybody has pressed
      // recompute. Writing the section's rows first is the only way an override
      // can carry a `computed_status` to differ from, and it is idempotent.
      if (!entry.hasRecord) {
        await computeSectionTermResults(auth.locationId, termId, sectionId);
      }

      const stored = await db
        .select({
          id: studentTermResults.id,
          mechanism: studentTermResults.mechanism,
          computedStatus: studentTermResults.computedStatus,
        })
        .from(studentTermResults)
        .where(
          and(
            eq(studentTermResults.locationId, auth.locationId),
            eq(studentTermResults.termId, termId),
            eq(studentTermResults.studentProfileId, body.studentProfileId),
          ),
        )
        .limit(1);

      const record = stored[0];
      if (record === undefined) {
        return apiFailure(
          'invalid_state',
          'This term has no computed result for that student yet.',
          409,
        );
      }

      const isOverride = body.finalStatus !== record.computedStatus;
      const reason = readString(body.overrideReason);

      if (isOverride && reason.trim().length < OVERRIDE_REASON_MIN) {
        return apiFailure(
          'invalid_body',
          `Changing the computed status needs a reason of at least ${OVERRIDE_REASON_MIN} characters. It is shown to the parent.`,
          422,
        );
      }

      const updates: Partial<typeof studentTermResults.$inferInsert> = {
        finalStatus: body.finalStatus,
        updatedAt: new Date(),
      };

      if (isOverride) {
        const actor = await getSchoolUserByUid(auth.locationId, auth.uid);
        updates.overrideReason = reason.trim();
        updates.overriddenBy = actor?.id ?? null;
        updates.overriddenAt = new Date();
      } else {
        // All three, or the portal keeps explaining a decision nobody made.
        updates.overrideReason = null;
        updates.overriddenBy = null;
        updates.overriddenAt = null;
      }

      if (body.overallSubcategoryId !== undefined) {
        if (record.mechanism !== 'descriptors') {
          return apiFailure(
            'invalid_body',
            'This class is judged on marks and grades, which has no overall sub-category.',
            400,
          );
        }

        if (body.overallSubcategoryId === null || body.overallSubcategoryId === '') {
          updates.overallSubcategoryId = null;
        } else {
          if (!isUuid(body.overallSubcategoryId)) {
            return apiFailure('invalid_body', 'Choose a sub-category, or none.', 400);
          }
          // Re-read through a tenant-filtered query: the foreign key alone
          // would accept another school's descriptor.
          const known = await listResultSubcategories(auth.locationId);
          if (!known.some((row) => row.id === body.overallSubcategoryId)) {
            return apiFailure('not_found', 'That sub-category was not found.', 404);
          }
          updates.overallSubcategoryId = body.overallSubcategoryId;
        }
      }

      await db
        .update(studentTermResults)
        .set(updates)
        .where(
          and(
            eq(studentTermResults.locationId, auth.locationId),
            eq(studentTermResults.id, record.id),
          ),
        );

      return apiSuccess({
        results: await getSectionTermResults(auth.locationId, termId, sectionId),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'exams.read' },
);
