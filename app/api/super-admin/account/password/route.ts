import { compare } from 'bcryptjs';
import type { NextRequest } from 'next/server';

import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import {
  findSuperAdminById,
  superAdminPasswordProblem,
  updateSuperAdmin,
} from '@/lib/super-admin-accounts';
import {
  SUPER_ADMIN_SESSION_SECONDS,
  sessionCookieOptions,
  signSuperAdminJWT,
} from '@/lib/super-admin-auth';
import { requireSuperAdmin } from '@/lib/super-admin-guard';

/**
 * PATCH /api/super-admin/account/password — change your own. Sprint 35, §9.
 *
 * Every super admin, the owner included, with the current password. The
 * current password is checked even though the session is already valid: an
 * unattended signed-in browser must not be enough to lock its owner out of
 * the platform.
 *
 * Not available on the environment-credential fallback: there is no row to
 * write to, and the environment hash is changed in the host's panel, not here.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PasswordBody {
  currentPassword?: unknown;
  newPassword?: unknown;
}

export async function PATCH(request: NextRequest) {
  try {
    const actor = await requireSuperAdmin();

    if (actor.adminId === null) {
      return apiFailure(
        'no_account_row',
        'You are signed in with the environment credential; the super admin table has not been set up yet.',
        409,
      );
    }

    const body = await readJsonBody<PasswordBody>(request);
    const current = typeof body?.currentPassword === 'string' ? body.currentPassword : '';
    if (current === '') return apiFailure('invalid_body', 'Enter your current password.', 400);

    const problem = superAdminPasswordProblem(body?.newPassword);
    if (problem !== null) return apiFailure('invalid_body', problem, 400);
    const next = String(body?.newPassword);

    const row = await findSuperAdminById(actor.adminId);
    if (row === null) return apiFailure('not_found', 'Your account could not be found.', 404);

    if (!(await compare(current, row.passwordHash))) {
      return apiFailure('wrong_password', 'Your current password is not correct.', 400);
    }
    if (current === next) {
      return apiFailure('invalid_body', 'Choose a password different from the current one.', 400);
    }

    const outcome = await updateSuperAdmin(actor.adminId, { password: next });
    if (!outcome.ok) return apiFailure(outcome.code, outcome.message, outcome.status);

    // Changing the password ends every other session of this account (the
    // guard refuses a token issued before `password_changed_at`), so this
    // browser gets a fresh one rather than being signed out with the rest.
    const response = apiSuccess({ changed: true });
    response.cookies.set({
      ...sessionCookieOptions(SUPER_ADMIN_SESSION_SECONDS),
      value: await signSuperAdminJWT(row.email, row.id),
    });
    return response;
  } catch (error) {
    return handleApiError(error);
  }
}
