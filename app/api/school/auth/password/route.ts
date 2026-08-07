import type { NextRequest } from 'next/server';

import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { validatePasswordStrength } from '@/lib/password-strength';
import { readSchoolSession } from '@/lib/school-auth';
import { getAuthenticatedUser, setUserPassword } from '@/lib/supabase-auth';
import { homeRouteForRole } from '@/types/school-auth';

/**
 * POST /api/school/auth/password — set or replace the caller's own password.
 *
 * The last step of signup, and the last step of a password reset. Both arrive
 * here the same way: having just proved possession of the address with a code,
 * so a session already exists.
 *
 * ── Why no "current password" field ──────────────────────────────────────
 * Because the code was the proof. Asking for the old password would make the
 * reset flow impossible for the only people who need it. What guards this
 * endpoint is the session: `readSchoolSession()` requires a live, active
 * membership of the school this request arrived at, so nobody can set a
 * password for an account that is not theirs.
 *
 * The strength rule is enforced here rather than left to the Supabase
 * dashboard, so it is visible in the code that depends on it — and it comes
 * from `lib/password-strength.ts`, the same module the field's strength meter
 * reads, so the form cannot accept what this refuses. GoTrue applies its own
 * configured policy on top; a failure there surfaces as a `SupabaseAuthError`
 * and is reported rather than swallowed.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PasswordBody {
  password?: unknown;
}

export async function POST(request: NextRequest) {
  try {
    const claims = await readSchoolSession();
    if (claims === null) {
      return apiFailure('unauthorized', 'Verify your email address first.', 401);
    }

    const body = await readJsonBody<PasswordBody>(request);
    const password = typeof body?.password === 'string' ? body.password : '';

    const strength = validatePasswordStrength(password);
    if (!strength.valid) {
      return apiFailure('weak_password', strength.error ?? 'Choose a stronger password.', 400);
    }

    // The claims carry the id, but re-reading the user keeps this route
    // honest about acting on the account the *cookie* authenticates rather
    // than on an id assembled elsewhere.
    const user = await getAuthenticatedUser();
    if (user === null) {
      return apiFailure('unauthorized', 'Verify your email address first.', 401);
    }

    await setUserPassword(user.id, password);

    return apiSuccess({ redirectTo: homeRouteForRole(claims.role) });
  } catch (error) {
    return handleApiError(error);
  }
}
