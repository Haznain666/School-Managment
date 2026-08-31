import { canAccessBranch, withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { getStaff } from '@/lib/hr-queries';
import { hasPermission } from '@/lib/permission-queries';
import {
  checkNewStaffLogin,
  createLoginForStaff,
  linkAccountToStaff,
  unlinkAccountFromStaff,
} from '@/lib/staff-portal-access';
import { isUuid, readOptionalString } from '@/lib/validation';

/**
 * /api/school/hr/staff/[staffId]/portal-access
 *
 * POST   link an existing account, or create a new login for this person
 * DELETE unlink — both records survive, only the join goes
 *
 * ── Why this is its own route and not three fields on the PATCH ──────────
 * PATCH amends the employment record: names, dates, bank details, a status.
 * Every one of those is a fact about the row it is written on. This is a
 * *relationship* between two rows, and creating half of it sends somebody an
 * email. Folding "and by the way mint an account and mail a password link"
 * into the same request as "correct the spelling of her surname" would make an
 * ordinary save capable of provisioning a login, which is not a thing a save
 * should ever be able to do by accident.
 *
 * It is also two permission keys rather than one — see below — and a route that
 * needs a different gate for one field than for the rest is a different route.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ staffId: string }> };

interface PortalAccessBody {
  mode?: unknown;
  schoolUserId?: unknown;
  role?: unknown;
  branchId?: unknown;
}

export const POST = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { staffId } = await context.params;
      if (!isUuid(staffId)) {
        return apiFailure('not_found', 'Staff member not found.', 404);
      }

      const existing = await getStaff(auth.locationId, staffId);
      if (existing === null) {
        return apiFailure('not_found', 'Staff member not found.', 404);
      }

      // A branch admin may not reach another branch's staff, even by direct id.
      if (existing.branchId !== null && !canAccessBranch(auth, existing.branchId)) {
        return apiFailure('not_found', 'Staff member not found.', 404);
      }

      const body = await readJsonBody<PortalAccessBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      if (existing.schoolUserId !== null) {
        return apiFailure(
          'already_exists',
          'This staff member is already linked to a portal account. Unlink it first.',
          409,
        );
      }

      if (body.mode === 'link') {
        /*
         * Linking needs `users.read` on top of `hr.write`: the picker that fed
         * this id is the user directory, and the id itself names a member of
         * it. `hr.write` alone decides who may *hold* the link, never who may
         * see the list of candidates.
         */
        if (!(await hasPermission(auth.locationId, auth.role, 'users.read'))) {
          return apiFailure(
            'forbidden',
            'Linking an account needs permission to see the user directory.',
            403,
          );
        }

        const schoolUserId = readOptionalString(body.schoolUserId);
        if (schoolUserId === null) {
          return apiFailure('invalid_body', 'Choose a portal account to link.', 400);
        }

        const outcome = await linkAccountToStaff(auth.locationId, staffId, schoolUserId);
        if (!outcome.linked) {
          return apiFailure('invalid_body', outcome.problem, 400);
        }

        return apiSuccess({ portalAccess: outcome });
      }

      if (body.mode === 'create') {
        // One screen, two permission keys — §2 of the sprint. Enforced here and
        // not only in the component, because a request posted directly never
        // runs the component.
        if (!(await hasPermission(auth.locationId, auth.role, 'users.write'))) {
          return apiFailure(
            'forbidden',
            'Creating a portal login also needs permission to manage users.',
            403,
          );
        }

        /*
         * The login is created against the employment record's **own** email
         * and phone, not against a second pair typed here. One person, one set
         * of contact details: asking twice is how the two records start
         * disagreeing on the day they are created.
         */
        const checked = await checkNewStaffLogin(auth.locationId, {
          role: body.role,
          // A branch admin's own branch always wins over a requested one.
          branchId:
            auth.branchId ?? readOptionalString(body.branchId) ?? existing.branchId,
          name: existing.fullName,
          phone: existing.phone ?? '',
          email: existing.email ?? '',
        });

        if (!checked.ok) {
          return apiFailure('invalid_body', checked.problem, 400);
        }

        const outcome = await createLoginForStaff(
          auth.locationId,
          auth.uid,
          staffId,
          checked.login,
        );

        /*
         * A refusal here is a 409 rather than a 500 and it is deliberate: the
         * two things that produce it — the address is a colleague's, the
         * number is — are conditions a school can meet and correct, and both
         * come back as the sentence naming which.
         */
        if (!outcome.linked) {
          return apiFailure('already_exists', outcome.problem, 409);
        }

        return apiSuccess({ portalAccess: outcome }, 201);
      }

      return apiFailure('invalid_body', 'Choose to link an account or create one.', 400);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'hr.write' },
);

export const DELETE = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { staffId } = await context.params;
      if (!isUuid(staffId)) {
        return apiFailure('not_found', 'Staff member not found.', 404);
      }

      const existing = await getStaff(auth.locationId, staffId);
      if (existing === null) {
        return apiFailure('not_found', 'Staff member not found.', 404);
      }

      if (existing.branchId !== null && !canAccessBranch(auth, existing.branchId)) {
        return apiFailure('not_found', 'Staff member not found.', 404);
      }

      /*
       * Unlinking deletes nothing. The account keeps its role and its sessions,
       * the employment record keeps its payslips, and only the sentence "these
       * are the same person" is withdrawn — which is exactly what somebody who
       * linked the wrong two rows needs, and nothing more.
       */
      const cleared = await unlinkAccountFromStaff(auth.locationId, staffId);
      if (!cleared) {
        return apiFailure('not_found', 'Staff member not found.', 404);
      }

      return apiSuccess({ portalAccess: null });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'hr.write' },
);
