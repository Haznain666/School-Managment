import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { listUnlinkedSchoolUsers } from '@/lib/hr-queries';
import { hasPermission } from '@/lib/permission-queries';

/**
 * /api/school/hr/staff/portal-accounts — the link picker's list.
 *
 * Active accounts of this school, in an invitable role, that no employment
 * record already claims. `listUnlinkedSchoolUsers` has existed since Sprint 7
 * and until now nothing called it, which is the whole reason
 * `staff.school_user_id` was null at every school in the product.
 *
 * ── Two permissions, and why the second is `read` and not `write` ────────
 * Choosing who to link is an `hr.write` act, so that is the gate. But the reply
 * is a page of the *user directory* — names, roles, campuses, addresses — and
 * that is `users.read`'s to give. An HR manager whose school has taken
 * `users.read` away from them should not get the directory through a side door
 * on an HR screen.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (_request, auth) => {
    try {
      if (!(await hasPermission(auth.locationId, auth.role, 'users.read'))) {
        return apiFailure(
          'forbidden',
          'Listing portal accounts needs permission to see the user directory.',
          403,
        );
      }

      return apiSuccess({ accounts: await listUnlinkedSchoolUsers(auth.locationId) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'hr.write' },
);
