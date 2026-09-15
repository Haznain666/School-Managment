import { and, eq, inArray } from 'drizzle-orm';

import { coordinatorTeachers } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { headIdentity, loadKpiContext } from '@/lib/kpi-access';
import { buildSetup } from '@/lib/kpi-board';
import { isUuid } from '@/lib/validation';

/**
 * PUT /api/school/kpis/coordinators — Sprint 32, rule 8.
 *
 * Sets the teachers one coordinator supervises. **A Principal only** (and a
 * Vice Principal, who holds the Principal's rights — rule 7c).
 *
 * ── Teacher by teacher, at the coordinator's own campus ──────────────────
 * Every teacher named must be at the coordinator's campus, and at a school
 * with several principals must be one of *this* principal's teachers. That is
 * what makes confirmation 5 true — a coordinator's rater is "the principal of
 * the teachers they supervise", a single principal, because the list was drawn
 * from one.
 *
 * ── Only the caller's own teachers are replaced ──────────────────────────
 * If another principal has assigned some of their teachers to this
 * coordinator, those links stay. A save replaces the subset in the caller's
 * reach and nothing else.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PUT = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<{ coordinatorUserId?: unknown; teacherUserIds?: unknown }>(
        request,
      );
      if (body === null || !isUuid(body.coordinatorUserId) || !Array.isArray(body.teacherUserIds)) {
        return apiFailure('invalid_body', 'Choose a coordinator and their teachers.', 400);
      }

      const wanted = [...new Set(body.teacherUserIds)];
      if (!wanted.every((id) => isUuid(id))) {
        return apiFailure('invalid_body', 'One of the teachers is not valid.', 400);
      }

      const ctx = await loadKpiContext(auth.locationId, auth);
      const head = headIdentity(ctx);
      if (head === null) {
        return apiFailure(
          'forbidden',
          'Your school has not said which principal you serve, so you cannot assign teachers yet.',
          403,
        );
      }

      const coordinator = ctx.byId.get(body.coordinatorUserId);
      if (
        coordinator === undefined ||
        coordinator.role !== 'coordinator' ||
        (ctx.branchIds !== null &&
          coordinator.branchId !== null &&
          !ctx.branchIds.includes(coordinator.branchId))
      ) {
        return apiFailure('not_found', 'That coordinator is not in your reach.', 404);
      }
      if (coordinator.branchId === null) {
        return apiFailure(
          'invalid_body',
          `${coordinator.name} is not assigned to a campus yet. Set their campus in Users & Staff first.`,
          400,
        );
      }

      const reachable = (teacherId: string): boolean => {
        const teacher = ctx.byId.get(teacherId);
        if (teacher === undefined || teacher.role !== 'teacher') return false;
        if (teacher.branchId !== coordinator.branchId) return false;
        if (head === 'all') return true;
        return ctx.teacherPrincipal.get(teacherId)?.principalUserId === head;
      };

      const refused = (wanted as string[]).filter((id) => !reachable(id));
      if (refused.length > 0) {
        const name = ctx.byId.get(refused[0]!)?.name ?? 'One of those teachers';
        return apiFailure(
          'forbidden',
          `${name} is not one of your teachers at ${coordinator.branchName ?? 'this campus'}.`,
          403,
        );
      }

      const mineNow = [...(ctx.supervised.get(coordinator.userId) ?? [])].filter(reachable);

      await db.transaction(async (tx) => {
        if (mineNow.length > 0) {
          await tx
            .delete(coordinatorTeachers)
            .where(
              and(
                eq(coordinatorTeachers.locationId, auth.locationId),
                eq(coordinatorTeachers.coordinatorUserId, coordinator.userId),
                inArray(coordinatorTeachers.teacherUserId, mineNow),
              ),
            );
        }
        if (wanted.length > 0) {
          await tx
            .insert(coordinatorTeachers)
            .values(
              (wanted as string[]).map((teacherUserId) => ({
                locationId: auth.locationId,
                coordinatorUserId: coordinator.userId,
                teacherUserId,
                branchId: coordinator.branchId!,
                assignedBy: ctx.caller.userId,
              })),
            )
            .onConflictDoNothing();
        }
      });

      const fresh = await loadKpiContext(auth.locationId, auth);
      return apiSuccess({ setup: await buildSetup(fresh) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: ['principal', 'vice_principal'], module: 'staff_kpis' },
);
