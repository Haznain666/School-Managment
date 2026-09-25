import type { NextRequest } from "next/server";

import {
  apiFailure,
  apiSuccess,
  handleApiError,
  readJsonBody,
} from "@/lib/api-response";
import { emailRejectionReason } from "@/lib/email-validation";
import { readPermissionGrid } from "@/lib/super-admin-admin-input";
import {
  deleteSuperAdmin,
  findSuperAdminById,
  listSuperAdmins,
  superAdminPasswordProblem,
  updateSuperAdmin,
  type SuperAdminPatch,
} from "@/lib/super-admin-accounts";
import { requireSuperAdmin } from "@/lib/super-admin-guard";
import {
  canManageSuperAdmin,
  normaliseSuperAdminPermissions,
} from "@/lib/super-admin-permissions";
import { isUuid } from "@/lib/validation";

/**
 * /api/super-admin/admins/[adminId] — Sprint 35, §9.
 *
 * PATCH  name, email, active, reset password — `super_admins` edit;
 *        permissions — the owner, and only the owner
 * DELETE the row — `super_admins` delete
 *
 * ── The owner's row, from here ───────────────────────────────────────────
 * Nobody but the owner may touch it at all, and the owner may change only
 * their own name here (their password is "My account"'s). It cannot be
 * deleted, deactivated, re-addressed or given a permission grid — the owner
 * holds everything implicitly. Each refusal is a sentence here first; the
 * trigger in `0052` is what makes it true for anything that bypasses this.
 *
 * ── Nobody removes themselves ────────────────────────────────────────────
 * Deactivating or deleting your own row signs you out on the next click with
 * nobody left to explain why. Refused; another admin, or the owner, can do it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ adminId: string }> };

interface PatchBody {
  name?: unknown;
  email?: unknown;
  isActive?: unknown;
  password?: unknown;
  permissions?: unknown;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const actor = await requireSuperAdmin("super_admins", "u");

    const { adminId } = await context.params;
    if (!isUuid(adminId))
      return apiFailure("not_found", "Super admin not found.", 404);

    const target = await findSuperAdminById(adminId);
    if (target === null)
      return apiFailure("not_found", "Super admin not found.", 404);

    const body = await readJsonBody<PatchBody>(request);
    if (body === null)
      return apiFailure("invalid_body", "Expected a JSON body.", 400);

    const patch: SuperAdminPatch = {};

    if (
      !target.isOwner &&
      !canManageSuperAdmin(actor, {
        isOwner: target.isOwner,
        permissions: normaliseSuperAdminPermissions(target.permissions),
      })
    ) {
      return apiFailure(
        "forbidden",
        "That admin holds rights you do not. Only the platform owner can change their account.",
        403,
      );
    }

    if (target.isOwner) {
      if (!actor.isOwner) {
        return apiFailure(
          "owner_protected",
          "Only the platform owner can change the owner’s account.",
          403,
        );
      }
      if (
        body.email !== undefined ||
        body.isActive !== undefined ||
        body.permissions !== undefined
      ) {
        return apiFailure(
          "owner_protected",
          "The owner’s email, status and permissions cannot be changed.",
          409,
        );
      }
      if (body.password !== undefined) {
        return apiFailure(
          "owner_protected",
          "Change your own password from My account.",
          409,
        );
      }
    }

    if (body.name !== undefined) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (name === "") return apiFailure("invalid_body", "Enter a name.", 400);
      patch.name = name;
    }

    if (body.email !== undefined) {
      const email = typeof body.email === "string" ? body.email.trim() : "";
      const problem =
        email === "" ? "Enter an email address." : emailRejectionReason(email);
      if (problem !== null) return apiFailure("invalid_body", problem, 400);
      patch.email = email;
    }

    if (body.isActive !== undefined) {
      if (typeof body.isActive !== "boolean") {
        return apiFailure(
          "invalid_body",
          "isActive must be true or false.",
          400,
        );
      }
      if (!body.isActive && actor.adminId === target.id) {
        return apiFailure(
          "self",
          "You cannot deactivate your own account.",
          409,
        );
      }
      patch.isActive = body.isActive;
    }

    if (body.password !== undefined) {
      const problem = superAdminPasswordProblem(body.password);
      if (problem !== null) return apiFailure("invalid_body", problem, 400);
      patch.password = String(body.password);
    }

    if (body.permissions !== undefined) {
      if (!actor.isOwner) {
        return apiFailure(
          "forbidden",
          "Only the platform owner can change permissions.",
          403,
        );
      }
      const grid = readPermissionGrid(body.permissions);
      if (grid === null)
        return apiFailure(
          "invalid_body",
          "The permission grid is incomplete.",
          400,
        );
      patch.permissions = grid;
    }

    const outcome = await updateSuperAdmin(adminId, patch);
    if (!outcome.ok)
      return apiFailure(outcome.code, outcome.message, outcome.status);

    return apiSuccess({ admins: await listSuperAdmins() });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const actor = await requireSuperAdmin("super_admins", "d");

    const { adminId } = await context.params;
    if (!isUuid(adminId))
      return apiFailure("not_found", "Super admin not found.", 404);

    const target = await findSuperAdminById(adminId);
    if (target === null)
      return apiFailure("not_found", "Super admin not found.", 404);

    if (target.isOwner) {
      return apiFailure(
        "owner_protected",
        "The platform owner cannot be deleted.",
        409,
      );
    }
    if (actor.adminId === target.id) {
      return apiFailure("self", "You cannot delete your own account.", 409);
    }

    if (
      !canManageSuperAdmin(actor, {
        isOwner: target.isOwner,
        permissions: normaliseSuperAdminPermissions(target.permissions),
      })
    ) {
      return apiFailure(
        "forbidden",
        "That admin holds rights you do not. Only the platform owner can change their account.",
        403,
      );
    }

    const outcome = await deleteSuperAdmin(adminId);
    if (!outcome.ok)
      return apiFailure(outcome.code, outcome.message, outcome.status);

    return apiSuccess({ admins: await listSuperAdmins() });
  } catch (error) {
    return handleApiError(error);
  }
}
