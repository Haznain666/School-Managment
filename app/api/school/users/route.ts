import { and, eq } from "drizzle-orm";

import { branches, schoolUsers } from "@/db/schema";
import {
  apiFailure,
  apiSuccess,
  handleApiError,
  readJsonBody,
} from "@/lib/api-response";
import { withSchoolAuth } from "@/lib/api-auth";
import {
  effectiveBranchIds,
  readBranchParam,
  resolveBranchScope,
  scopeAdmitsWrite,
} from "@/lib/branch-scope";
import { db } from "@/lib/drizzle";
import { readListQuery } from "@/lib/list-query";
import {
  emailHolderAt,
  isEmailIndexConflict,
  isUserStatus,
  listSchoolUsers,
  SCHOOL_USER_SORT_COLUMNS,
} from "@/lib/school-queries";
import { isUuid, readOptionalString, readString } from "@/lib/validation";
import { BRANCH_REQUIRED_ROLES, isUserRole } from "@/types/school-auth";

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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);

      // Three displayed states, not two. `isActive` used to be the whole
      // filter, which meant "Active only" also returned everyone who had never
      // signed in — see `USER_STATUSES` in `lib/school-queries.ts`.
      const statusParam = url.searchParams.get("status");
      const status = isUserStatus(statusParam) ? statusParam : undefined;

      const scope = await resolveBranchScope(
        auth.locationId,
        auth,
        readBranchParam(url),
      );

      /*
       * The dropdown's own choice, honoured only inside the boundary below. A
       * value naming a campus outside it narrows to nothing rather than
       * widening — `and(inArray(scope), eq(other))` is empty, which is the safe
       * direction and the reason this can be taken from the client at all.
       */
      const branchId = url.searchParams.get("branchId") ?? undefined;

      const list = readListQuery(url.searchParams, {
        sortable: SCHOOL_USER_SORT_COLUMNS,
        defaultSort: "name",
        defaultDirection: "asc",
        // Stated rather than inherited (Sprint 19a, item 7). It is already
        // `readListQuery`'s default and `DataTable`'s, and writing it here is
        // what makes those three the same number on purpose rather than by
        // coincidence — a page size that drifted between the server's cap and
        // the browser's is how a reader pages off the end of a list.
        defaultLimit: 50,
      });

      const result = await listSchoolUsers(auth.locationId, {
        role: url.searchParams.get("role") ?? undefined,
        branchId,
        branchIds: effectiveBranchIds(scope),
        status,
        // Sprint 22's reconciliation filter. One value, and anything else is
        // "off" — a filter that narrowed on an unrecognised word would hide
        // rows without saying it had.
        employment:
          url.searchParams.get("employment") === "none" ? "none" : undefined,
        search: url.searchParams.get("search") ?? undefined,
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
  { permission: "users.read" },
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
        return apiFailure("invalid_body", "Expected a JSON body.", 400);
      }

      const name = readString(body.name);
      const phone = readString(body.phone);

      if (name === "" || phone === "") {
        return apiFailure("invalid_body", "Name and phone are required.", 400);
      }

      if (!isUserRole(body.role)) {
        return apiFailure("invalid_body", "Select a valid role.", 400);
      }

      const branchId = typeof body.branchId === "string" ? body.branchId : null;

      if (BRANCH_REQUIRED_ROLES.includes(body.role) && branchId === null) {
        return apiFailure("invalid_body", "This role requires a branch.", 400);
      }

      if (branchId !== null) {
        if (!isUuid(branchId)) {
          return apiFailure("invalid_body", "That branch does not exist.", 400);
        }

        // The branch must belong to this school — a UUID from another tenant
        // must not slip through the foreign key.
        const owned = await db
          .select({ id: branches.id })
          .from(branches)
          .where(
            and(
              eq(branches.id, branchId),
              eq(branches.locationId, auth.locationId),
            ),
          )
          .limit(1);

        if (owned[0] === undefined) {
          return apiFailure("invalid_body", "That branch does not exist.", 400);
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
          "forbidden",
          branchId === null
            ? "Only a school-wide administrator can add a member with no campus."
            : "You do not have access to that campus.",
          403,
        );
      }

      /*
       * The address is checked before the write, and again after it fails.
       *
       * `school_users` has had two unique indexes since `0038` — the phone one
       * and the address one — and the `onConflictDoNothing()` below used to be
       * untargeted, so it swallowed both and reported whichever it caught as
       * the phone. An administrator adding a member on a free number but a
       * colleague's address was told "someone with that phone number already
       * exists", about a number nobody held. There was nothing on the form for
       * them to correct and no reason to look at the address.
       */
      const email = readOptionalString(body.email);
      const holder = await emailHolderAt(auth.locationId, email);

      if (holder !== null) {
        return apiFailure(
          "already_exists",
          `${holder.name} already uses that email address at this school, and one address can open only one account.`,
          409,
        );
      }

      let inserted;
      try {
        inserted = await db
          .insert(schoolUsers)
          .values({
            // Tenant comes from the verified session, never from the body.
            locationId: auth.locationId,
            name,
            phone,
            email,
            role: body.role,
            branchId,
            invitedByUid: auth.uid,
          })
          // Targeted, so only the phone collision is swallowed. An address
          // collision that arrives between the read above and this write —
          // a second administrator, the same minute — must raise rather than
          // vanish, and the catch below turns it into the same sentence.
          .onConflictDoNothing({
            target: [schoolUsers.locationId, schoolUsers.phone],
          })
          .returning({ id: schoolUsers.id, name: schoolUsers.name });
      } catch (error) {
        if (!isEmailIndexConflict(error)) throw error;
        return apiFailure(
          "already_exists",
          "Somebody else at this school was just given that email address. One address can open only one account.",
          409,
        );
      }

      const user = inserted[0];
      if (user === undefined) {
        return apiFailure(
          "already_exists",
          "Someone with that phone number already exists at this school.",
          409,
        );
      }

      return apiSuccess({ user }, 201);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: "users.write" },
);
