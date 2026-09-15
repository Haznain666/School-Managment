import { teacherPrincipalTransfers } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { loadKpiContext } from '@/lib/kpi-access';
import { buildSetup } from '@/lib/kpi-board';
import { isUuid } from '@/lib/validation';

/**
 * POST /api/school/kpis/principals/transfers — Sprint 32, rule 7b.
 *
 * A principal asks for a teacher to move to them, or from them to another
 * principal. It is the only override of the derived answer, and it is a
 * request: the other principal accepts it (fourth pass, confirmation 3).
 * A teacher nobody holds yet has no other principal, so that request waits for
 * the School Administrator.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<{
        teacherUserId?: unknown;
        toPrincipalUserId?: unknown;
        note?: unknown;
      }>(request);
      if (body === null || !isUuid(body.teacherUserId) || !isUuid(body.toPrincipalUserId)) {
        return apiFailure('invalid_body', 'Choose a teacher and the principal they should move to.', 400);
      }

      const ctx = await loadKpiContext(auth.locationId, auth);
      if (ctx.model !== 'multiple') {
        return apiFailure(
          'invalid_body',
          'Your school runs one principal, so every teacher is already theirs.',
          400,
        );
      }

      const me = ctx.caller.userId;
      const teacher = ctx.byId.get(body.teacherUserId);
      const to = ctx.byId.get(body.toPrincipalUserId);
      if (teacher === undefined || teacher.role !== 'teacher') {
        return apiFailure('not_found', 'That teacher does not exist.', 404);
      }
      if (to === undefined || to.role !== 'principal') {
        return apiFailure('invalid_body', 'Choose one of the school’s principals.', 400);
      }

      const from = ctx.teacherPrincipal.get(teacher.userId)?.principalUserId ?? null;
      if (from === to.userId) {
        return apiFailure('invalid_body', `${teacher.name} is already ${to.name}’s.`, 400);
      }
      if (me === null || (me !== from && me !== to.userId)) {
        return apiFailure(
          'forbidden',
          'A transfer is requested by the principal the teacher is leaving or joining.',
          403,
        );
      }

      const note =
        typeof body.note === 'string' && body.note.trim() !== '' ? body.note.trim().slice(0, 500) : null;

      const inserted = await db
        .insert(teacherPrincipalTransfers)
        .values({
          locationId: auth.locationId,
          teacherUserId: teacher.userId,
          fromPrincipalUserId: from,
          toPrincipalUserId: to.userId,
          requestedBy: me,
          note,
        })
        .onConflictDoNothing()
        .returning({ id: teacherPrincipalTransfers.id });

      if (inserted.length === 0) {
        return apiFailure(
          'conflict',
          `There is already a transfer request open for ${teacher.name}. Decide or cancel that one first.`,
          409,
        );
      }

      return apiSuccess({ setup: await buildSetup(ctx) }, 201);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: ['principal'], module: 'staff_kpis' },
);
