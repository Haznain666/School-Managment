import { asc, eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { branches, schools, schoolUsers } from '@/db/schema';
import { queueAccessEmail } from '@/lib/access-email';
import {
  apiFailure,
  apiSuccess,
  handleApiError,
  readJsonBody,
} from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { readEmailField } from '@/lib/profile-fields';
import { createFirstSchoolAdmin } from '@/lib/school-bootstrap';
import { resolveLocationId } from '@/lib/schools';
import { requireSuperAdmin } from '@/lib/super-admin-guard';
import { isUuid, readString } from '@/lib/validation';

/**
 * /api/super-admin/schools/[schoolId]/users
 *
 * GET  every member of one school, for the platform operator's view
 * POST provision an administrator for a school that has none
 *
 * Cross-tenant by design — the Super Admin has no tenant of their own — so the
 * gate is the operator session, checked by middleware and again here.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ schoolId: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    await requireSuperAdmin();

    const { schoolId } = await context.params;
    if (!isUuid(schoolId)) {
      return apiFailure('not_found', 'School not found.', 404);
    }

    const locationId = await resolveLocationId(schoolId);
    if (locationId === null) {
      return apiFailure('not_found', 'School not found.', 404);
    }

    const rows = await db
      .select({
        id: schoolUsers.id,
        name: schoolUsers.name,
        role: schoolUsers.role,
        phone: schoolUsers.phone,
        email: schoolUsers.email,
        isActive: schoolUsers.isActive,
        branchName: branches.name,
        joinedAt: schoolUsers.joinedAt,
        // Drives whether an emergency link can be issued at all. A row only
        // gains an `auth_user_id` once the person has signed in for the first
        // time, so this doubles as "has ever got in".
        hasAuthAccount: schoolUsers.authUserId,
      })
      .from(schoolUsers)
      .leftJoin(branches, eq(branches.id, schoolUsers.branchId))
      .where(eq(schoolUsers.locationId, locationId))
      .orderBy(asc(schoolUsers.name));

    return apiSuccess({
      users: rows.map((row) => ({
        id: row.id,
        name: row.name,
        role: row.role,
        phone: row.phone,
        email: row.email,
        isActive: row.isActive,
        branchName: row.branchName,
        joinedAt: row.joinedAt,
        hasAuthAccount: row.hasAuthAccount !== null,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

interface CreateAdminBody {
  name?: unknown;
  phone?: unknown;
  email?: unknown;
}

/**
 * POST /api/super-admin/schools/[schoolId]/users
 *
 * Creates a `school_admin` for a school that cannot yet create one for itself.
 *
 * Deliberately limited to that one role. Everyone else — teachers, accountants,
 * parents — is invited from inside the school portal by someone who belongs
 * there, and this endpoint exists only to break the circular dependency that
 * leaves a brand-new school with nobody able to sign in.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    // Captured so the issued setup token records who asked for it.
    const session = await requireSuperAdmin();

    const { schoolId } = await context.params;
    if (!isUuid(schoolId)) {
      return apiFailure('not_found', 'School not found.', 404);
    }

    const locationId = await resolveLocationId(schoolId);
    if (locationId === null) {
      return apiFailure('not_found', 'School not found.', 404);
    }

    const body = await readJsonBody<CreateAdminBody>(request);
    if (body === null) {
      return apiFailure('invalid_body', 'Expected a JSON body.', 400);
    }

    const name = readString(body.name);
    const phone = readString(body.phone);
    if (name === '') {
      return apiFailure('invalid_body', "Enter the administrator's name.", 400);
    }
    if (phone === '') {
      return apiFailure('invalid_body', 'Enter a mobile number.', 400);
    }

    // Required here, though `createFirstSchoolAdmin` still tolerates its
    // absence for the school-provisioning path that infers it from the
    // principal. Sign-in is by email: an administrator created without one is
    // an account nobody can ever use, and this is the screen where that
    // mistake is made deliberately rather than inherited.
    //
    // Checked properly rather than with the `includes('@')` test this used to
    // carry, which accepted `@`, `a@b` and `admin@school` — the last of which
    // is the typo people actually make, and which Supabase then rejects when
    // the account is created, long after this screen has closed.
    const emailField = readEmailField(body.email);
    if (!emailField.ok) return apiFailure('invalid_body', emailField.message, 400);

    const email = emailField.value;
    if (email === null) {
      return apiFailure(
        'invalid_body',
        'Enter an email address — it is how they sign in.',
        400,
      );
    }

    const result = await createFirstSchoolAdmin(db, {
      locationId,
      name,
      phone,
      email,
    });

    // Here the details were typed deliberately rather than inherited from a
    // school profile, so an unusable number is a mistake worth reporting
    // instead of a condition worth tolerating.
    if (result.status === 'skipped') {
      return apiFailure('invalid_body', result.reason, 400);
    }

    if (result.status === 'exists') {
      return apiFailure(
        'already_exists',
        'Someone with that number already belongs to this school.',
        409,
      );
    }

    /**
     * Send the access email now, rather than waiting for a button.
     *
     * This route used to create the row and stop, leaving "Send sign-in email"
     * as a separate press an operator had to know to make. That is the whole
     * of the reported defect "I created an administrator and they never
     * received anything" — nothing was ever sent, and no screen said so.
     *
     * A failure here does not fail the request: the member exists and is
     * useful, and the commonest cause is the platform's own SMTP being
     * misconfigured, which is not something to undo a provisioning over. The
     * outcome is returned so the panel can say plainly whether mail went out.
     */
    const schoolRows = await db
      .select({ name: schools.name, slug: schools.slug })
      .from(schools)
      .where(eq(schools.id, schoolId))
      .limit(1);

    const school = schoolRows[0];
    const access =
      school === undefined
        ? { queued: false as const, reason: 'The school could not be re-read.' }
        : await queueAccessEmail({
            locationId,
            school,
            member: {
              id: result.userId,
              name,
              email,
              // Freshly created, so never through setup — this always produces
              // the setup link rather than the "where to sign in" reminder.
              authUserId: null,
            },
            createdBy: session.email,
          });

    // `authAccount` says whether the address was registered with Supabase —
    // `failed` is worth seeing, because it means the early duplicate check did
    // not happen and the account will instead be created at password setup.
    return apiSuccess(
      {
        userId: result.userId,
        phone: result.phone,
        email,
        authAccount: result.authAccount,
        emailQueued: access.queued,
        emailProblem: access.queued ? null : access.reason,
      },
      201,
    );
  } catch (error) {
    return handleApiError(error);
  }
}
