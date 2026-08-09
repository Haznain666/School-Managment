import { and, eq } from 'drizzle-orm';

import { branches, schoolUsers } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { withSchoolAuth } from '@/lib/api-auth';
import { db } from '@/lib/drizzle';
import { isUserStatus, listSchoolUsers } from '@/lib/school-queries';
import { isUuid, readOptionalString, readString } from '@/lib/validation';
import { BRANCH_REQUIRED_ROLES, isUserRole } from '@/types/school-auth';

/**
 * /api/school/users — the school's own directory.
 *
 * GET  list, filtered and paginated
 * POST create a member directly, without an invitation
 *
 * A branch_admin sees only their own branch: their `branchId` claim overrides
 * whatever they ask for, so the filter cannot be widened from the client.
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

      // A branch-scoped admin is confined to their branch regardless of input.
      const branchId =
        auth.branchId ?? (url.searchParams.get('branchId') ?? undefined);

      const pageRaw = Number.parseInt(url.searchParams.get('page') ?? '1', 10);
      const limitRaw = Number.parseInt(url.searchParams.get('limit') ?? '20', 10);

      const result = await listSchoolUsers(auth.locationId, {
        role: url.searchParams.get('role') ?? undefined,
        branchId: branchId === null ? undefined : branchId,
        status,
        search: url.searchParams.get('search') ?? undefined,
        page: Number.isFinite(pageRaw) ? pageRaw : 1,
        limit: Number.isFinite(limitRaw) ? limitRaw : 20,
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
