import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { withSchoolAuth } from '@/lib/api-auth';
import {
  countActiveSchoolAdmins,
  deleteSchoolMember,
  listSchoolUsersByIds,
} from '@/lib/school-queries';
import { consumesAdminSlot, schoolDeleteRefusal } from '@/lib/school-user-policy';
import {
  deletionSummary,
  MAX_BULK_DELETE,
  referencedExplanation,
  type DeletionOutcome,
} from '@/lib/user-deletion';
import { isUuid } from '@/lib/validation';

/**
 * POST /api/school/users/bulk-delete — remove several members in one action.
 *
 * ── Why this is not one statement ────────────────────────────────────────
 * A single `DELETE ... WHERE id IN (...)` is all-or-nothing, and several
 * foreign keys into `school_users` are `NO ACTION`. One member whose name is on
 * a register would refuse the whole batch, and the operator would have no way
 * to find out which one short of deleting them individually — which is exactly
 * the work this route exists to avoid. So each row is attempted on its own and
 * the refusals come back with their reasons.
 *
 * That means a partial result is the normal outcome, not an error, and the
 * response says so per row rather than in a status code.
 *
 * ── Why POST and not DELETE ──────────────────────────────────────────────
 * The ids travel in a body. `fetch` may send a body with DELETE but several
 * intermediaries drop it, and the challan print cap (STATE.md §5e) is the
 * standing reminder that a hundred uuids on a URL is not a safe place to put
 * them either.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface BulkDeleteBody {
  userIds?: unknown;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<BulkDeleteBody>(request);
      if (body === null || !Array.isArray(body.userIds)) {
        return apiFailure('invalid_body', 'Expected { userIds: string[] }.', 400);
      }

      const requested = [
        ...new Set(body.userIds.filter((id): id is string => isUuid(id))),
      ];

      if (requested.length === 0) {
        return apiFailure('invalid_body', 'Select at least one user.', 400);
      }

      if (requested.length > MAX_BULK_DELETE) {
        return apiFailure(
          'invalid_body',
          `Delete at most ${MAX_BULK_DELETE} users at a time.`,
          400,
        );
      }

      // Tenant-filtered: ids belonging to another school do not come back, and
      // are reported below as not found rather than acted on.
      const members = await listSchoolUsersByIds(auth.locationId, requested);
      const found = new Map(members.map((member) => [member.id, member]));

      let adminsRemaining = await countActiveSchoolAdmins(auth.locationId);
      const outcomes: DeletionOutcome[] = [];

      for (const id of requested) {
        const member = found.get(id);

        if (member === undefined) {
          outcomes.push({
            id,
            name: 'Unknown user',
            deleted: false,
            reason: 'That user is not a member of this school.',
          });
          continue;
        }

        const refusal = schoolDeleteRefusal(auth, member, adminsRemaining);
        if (refusal !== null) {
          outcomes.push({ id, name: member.name, deleted: false, reason: refusal });
          continue;
        }

        const result = await deleteSchoolMember(auth.locationId, id);

        if (result.deleted) {
          // Decremented only on success, so the "last administrator" guard
          // above sees the school as it actually is by the time it reaches the
          // next row.
          if (consumesAdminSlot(member)) adminsRemaining -= 1;
          outcomes.push({ id, name: member.name, deleted: true, reason: null });
          continue;
        }

        outcomes.push({
          id,
          name: member.name,
          deleted: false,
          reason:
            result.refusal === 'referenced'
              ? referencedExplanation(member.name)
              : 'That user is not a member of this school.',
        });
      }

      return apiSuccess({
        outcomes,
        deleted: outcomes.filter((outcome) => outcome.deleted).length,
        summary: deletionSummary(outcomes),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'users.write' },
);
