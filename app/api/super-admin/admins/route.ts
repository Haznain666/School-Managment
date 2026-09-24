import type { NextRequest } from 'next/server';

import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { emailRejectionReason } from '@/lib/email-validation';
import { readPermissionGrid } from '@/lib/super-admin-admin-input';
import {
  createSuperAdmin,
  listSuperAdmins,
  superAdminPasswordProblem,
} from '@/lib/super-admin-accounts';
import { requireSuperAdmin } from '@/lib/super-admin-guard';
import { emptySuperAdminPermissions } from '@/lib/super-admin-permissions';

/**
 * /api/super-admin/admins — the operators. Sprint 35, §9.
 *
 * GET  everybody, owner first — `super_admins` view
 * POST one more — `super_admins` create
 *
 * ── Only the owner sets permissions ──────────────────────────────────────
 * An admin who may create other admins may **not** decide what they can do:
 * otherwise "may create admins" would be "may grant anybody everything", which
 * is the owner's power by another name. So a `permissions` field from anybody
 * but the owner is refused outright rather than quietly dropped — a silent
 * drop would let the creator believe they had granted something. A new admin
 * made by a non-owner starts with nothing ticked until the owner says so.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const actor = await requireSuperAdmin('super_admins', 'r');
    return apiSuccess({
      admins: await listSuperAdmins(),
      viewer: { adminId: actor.adminId, isOwner: actor.isOwner },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

interface CreateBody {
  name?: unknown;
  email?: unknown;
  password?: unknown;
  permissions?: unknown;
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireSuperAdmin('super_admins', 'c');

    const body = await readJsonBody<CreateBody>(request);
    if (body === null) return apiFailure('invalid_body', 'Expected a JSON body.', 400);

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim() : '';

    if (name === '') return apiFailure('invalid_body', 'Enter a name.', 400);
    if (email === '') return apiFailure('invalid_body', 'Enter an email address.', 400);
    const emailProblem = emailRejectionReason(email);
    if (emailProblem !== null) return apiFailure('invalid_body', emailProblem, 400);

    const passwordProblem = superAdminPasswordProblem(body.password);
    if (passwordProblem !== null) return apiFailure('invalid_body', passwordProblem, 400);

    let permissions = emptySuperAdminPermissions();
    if (body.permissions !== undefined) {
      if (!actor.isOwner) {
        return apiFailure('forbidden', 'Only the platform owner can set permissions.', 403);
      }
      const grid = readPermissionGrid(body.permissions);
      if (grid === null) return apiFailure('invalid_body', 'The permission grid is incomplete.', 400);
      permissions = grid;
    }

    const outcome = await createSuperAdmin({
      name,
      email,
      password: String(body.password),
      permissions,
      createdBy: actor.email,
    });
    if (!outcome.ok) return apiFailure(outcome.code, outcome.message, outcome.status);

    return apiSuccess({ admins: await listSuperAdmins() }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
