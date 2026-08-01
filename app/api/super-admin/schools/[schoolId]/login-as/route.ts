import type { NextRequest } from 'next/server';

import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { buildHandoffUrl, signHandoffToken } from '@/lib/platform-school-access';
import { getSchoolById } from '@/lib/schools';
import { requireSuperAdmin } from '@/lib/super-admin-guard';
import { verifySuperAdminCredentials } from '@/lib/super-admin-credentials';

/**
 * POST /api/super-admin/schools/[schoolId]/login-as
 *
 * Issues a hand-off URL that drops the platform operator into one school's
 * admin portal, bypassing the WhatsApp passcode that school members use.
 *
 * ── Why the password is asked for again ──────────────────────────────────
 * The caller already holds a panel session — middleware would not have let this
 * request through otherwise. Re-entering the password is a step-up, not a
 * login: entering a customer's tenant and reading their students' records is a
 * different act from browsing the platform's own school list, and an unattended
 * laptop with a live panel session should not be able to do it silently.
 *
 * The submitted address must also match the session's, so a second operator
 * cannot borrow the first one's open panel by typing their own credentials.
 */

// bcrypt, jose and the env reads all need the Node runtime.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ schoolId: string }> };

interface LoginAsBody {
  email?: unknown;
  password?: unknown;
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireSuperAdmin();
    const { schoolId } = await context.params;

    const body = await readJsonBody<LoginAsBody>(request);
    if (body === null) {
      return apiFailure('invalid_body', 'Expected a JSON body.', 400);
    }

    const check = await verifySuperAdminCredentials(body.email, body.password);

    if (!check.ok) {
      return check.reason === 'misconfigured'
        ? apiFailure(
            'server_misconfigured',
            'Super Admin access is not configured on this deployment.',
            500,
          )
        : apiFailure('invalid_credentials', 'Incorrect email or password.', 401);
    }

    if (check.email !== session.email.trim().toLowerCase()) {
      return apiFailure(
        'invalid_credentials',
        'Those credentials belong to a different account than this session.',
        401,
      );
    }

    const school = await getSchoolById(schoolId);
    if (school === null) {
      return apiFailure('not_found', 'School not found.', 404);
    }

    // A deactivated tenant is closed to its own members; it is not a back door
    // for the operator either. Reactivate it first.
    if (!school.isActive) {
      return apiFailure(
        'school_inactive',
        'This school is deactivated. Reactivate it before signing in.',
        409,
      );
    }

    const token = await signHandoffToken({
      locationId: school.locationId,
      email: check.email,
    });

    const host = request.headers.get('host') ?? '';
    const protocol = new URL(request.url).protocol;

    return apiSuccess({
      loginUrl: buildHandoffUrl(token, school.slug, host, protocol),
      schoolName: school.schoolName,
      schoolSlug: school.slug,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
