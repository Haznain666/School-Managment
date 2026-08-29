import { and, eq } from 'drizzle-orm';

import { branches, schoolUsers } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { withSchoolAuth } from '@/lib/api-auth';
import {
  effectiveBranchIds,
  readBranchParam,
  resolveBranchScope,
  scopeAdmitsWrite,
} from '@/lib/branch-scope';
import { db } from '@/lib/drizzle';
import { readListQuery } from '@/lib/list-query';
import {
  isUserStatus,
  listSchoolUsers,
  SCHOOL_USER_SORT_COLUMNS,
} from '@/lib/school-queries';
import { isUuid, readOptionalString, readString } from '@/lib/validation';
import { BRANCH_REQUIRED_ROLES, isUserRole } from '@/types/school-auth';

/**
 * /api/school/users — the school's own directory.
 *
 * GET  list, filtered and paginated
 * POST create a member directly, without an invitation
 *
 * A branch-bound member sees only the campuses `resolveBranchScope` gives them
 * — their own, plus anything granted in `school_user_branches`. The boundary is
 * applied inside `listSchoolUsers`, to the page query, the total **and** all
 * three facet counts, so the dropdown can never offer a campus whose rows the
 * list would refuse to show.
 *
 * Before Sprint 19a this read `auth.branchId` directly and pinned the filter to
 * it. That was correct as far as it went and had no way to express a grant.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);

      // Three displayed states, not two. `isActive` used to be the whole
      // filter, which meant "Active only" also returned everyone who had never
      // signed in — see `USER_STATUSES` in `lib/school-queries.ts`.
      const statusParam = url.searchParams.get('status');
      const status = isUserStatus(statusParam) ? statusParam : undefined;

      const scope = await resolveBranchScope(auth.locationId, auth, readBranchParam(url));

      /*
       * The dropdown's own choice, honoured only inside the boundary below. A
       * value naming a campus outside it narrows to nothing rather than
       * widening — `and(inArray(scope), eq(other))` is empty, which is the safe
       * direction and the reason this can be taken from the client at all.
       */
      const branchId = url.searchParams.get('branchId') ?? undefined;

      const list = readListQuery(url.searchParams, {
        sortable: SCHOOL_USER_SORT_COLUMNS,
        defaultSort: 'name',
        defaultDirection: 'asc',
        // Stated rather than inherited (Sprint 19a, item 7). It is already
        // `readListQuery`'s default and `DataTable`'s, and writing it here is
        // what makes those three the same number on purpose rather than by
        // coincidence — a page size that drifted between the server's cap and
        // the browser's is how a reader pages off the end of a list.
        defaultLimit: 50,
      });

      const result = await listSchoolUsers(auth.locationId, {
        role: url.searchParams.get('role') ?? undefined,
        branchId,
        branchIds: effectiveBranchIds(scope),
        status,
        search: url.searchParams.get('search') ?? undefined,
        page: list.page,
        limit: list.limit,
        sort: list.sort,
        direction: list.direction,
      });

      return apiSuccess(result);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'users.read' },
);

interface CreateUserBody {
  name?: unknown;
  phone?: unknown;
  email?: unknown;
  role?: unknown;
  branchId?: unknown;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<CreateUserBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const name = readString(body.name);
      const phone = readString(body.phone);

      if (name === '' || phone === '') {
        return apiFailure('invalid_body', 'Name and phone are required.', 400);
      }

      if (!isUserRole(body.role)) {
        return apiFailure('invalid_body', 'Select a valid role.', 400);
      }

      const branchId = typeof body.branchId === 'string' ? body.branchId : null;

      if (BRANCH_REQUIRED_ROLES.includes(body.role) && branchId === null) {
        return apiFailure('invalid_body', 'This role requires a branch.', 400);
      }

      if (branchId !== null) {
        if (!isUuid(branchId)) {
          return apiFailure('invalid_body', 'That branch does not exist.', 400);
        }

        // The branch must belong to this school — a UUID from another tenant
        // must not slip through the foreign key.
        const owned = await db
          .select({ id: branches.id })
          .from(branches)
          .where(and(eq(branches.id, branchId), eq(branches.locationId, auth.locationId)))
          .limit(1);

        if (owned[0] === undefined) {
          return apiFailure('invalid_body', 'That branch does not exist.', 400);
        }
      }

      /*
       * Item 2e. A campus administrator may add somebody to their own campus
       * and not to another's — nor to no campus at all, which would mint a
       * school-wide member from inside one branch.
       */
      const scope = await resolveBranchScope(auth.locationId, auth);
      if (!scopeAdmitsWrite(scope, branchId)) {
        return apiFailure(
          'forbidden',
          branchId === null
            ? 'Only a school-wide administrator can add a member with no campus.'
            : 'You do not have access to that campus.',
          403,
        );
      }

      const inserted = await db
        .insert(schoolUsers)
        .values({
          // Tenant comes from the verified session, never from the body.
          locationId: auth.locationId,
          name,
          phone,
          email: readOptionalString(body.email),
          role: body.role,
          branchId,
          invitedByUid: auth.uid,
        })
        // Phone is unique per school.
        .onConflictDoNothing()
        .returning({ id: schoolUsers.id, name: schoolUsers.name });

      const user = inserted[0];
      if (user === undefined) {
        return apiFailure(
          'already_exists',
          'Someone with that phone number already exists at this school.',
          409,
        );
      }

      return apiSuccess({ user }, 201);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'users.write' },
);
