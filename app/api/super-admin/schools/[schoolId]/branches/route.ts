import { asc, eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { branches, isCurriculumLevel, schools } from '@/db/schema';
import { queueAccessEmail } from '@/lib/access-email';
import { demoteOtherMainBranches } from '@/lib/branches';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { sanitiseClassLevels } from '@/lib/branch-classes';
import { isPakistaniCity } from '@/lib/cities';
import { db } from '@/lib/drizzle';
import {
  readCoordinate,
  readEmailField,
  readLandlineField,
  readMobileField,
} from '@/lib/profile-fields';
import { createFirstSchoolAdmin } from '@/lib/school-bootstrap';
import { resolveLocationId } from '@/lib/schools';
import { requireSuperAdmin } from '@/lib/super-admin-guard';
import { isUuid, readOptionalString, readString } from '@/lib/validation';

/**
 * /api/super-admin/schools/[schoolId]/branches
 *
 * GET  every campus of one school
 * POST create a campus
 *
 * A school has at most one main branch. When a branch is created as the main
 * one, the previous holder is demoted in the same request.
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
      .select()
      .from(branches)
      .where(eq(branches.locationId, locationId))
      .orderBy(asc(branches.code));

    return apiSuccess({ branches: rows });
  } catch (error) {
    return handleApiError(error);
  }
}

interface CreateBranchBody {
  name?: unknown;
  code?: unknown;
  city?: unknown;
  address?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  landline?: unknown;
  phone?: unknown;
  email?: unknown;
  curriculumLevel?: unknown;
  boardName?: unknown;
  classLevels?: unknown;
  isMainBranch?: unknown;
  isActive?: unknown;
  /** Invite the branch email as this campus's administrator. */
  inviteAsBranchAdmin?: unknown;
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    // Captured so any setup token issued below records who asked for it.
    const session = await requireSuperAdmin();

    const { schoolId } = await context.params;
    if (!isUuid(schoolId)) {
      return apiFailure('not_found', 'School not found.', 404);
    }

    const locationId = await resolveLocationId(schoolId);
    if (locationId === null) {
      return apiFailure('not_found', 'School not found.', 404);
    }

    // Read once here rather than inside the invite branch, so a school that
    // vanished between the two is a 404 and not a half-created branch.
    const schoolRows = await db
      .select({ name: schools.name, slug: schools.slug })
      .from(schools)
      .where(eq(schools.id, schoolId))
      .limit(1);

    const schoolRow = schoolRows[0];
    if (schoolRow === undefined) {
      return apiFailure('not_found', 'School not found.', 404);
    }

    const body = await readJsonBody<CreateBranchBody>(request);
    if (body === null) {
      return apiFailure('invalid_body', 'Expected a JSON body.', 400);
    }

    const name = readString(body.name);
    const code = readString(body.code).toUpperCase();
    const city = readString(body.city);

    if (name === '' || code === '') {
      return apiFailure('invalid_body', 'Branch name and code are required.', 400);
    }

    if (!isPakistaniCity(city)) {
      return apiFailure('invalid_body', 'Select a city from the list.', 400);
    }

    if (!isCurriculumLevel(body.curriculumLevel)) {
      return apiFailure(
        'invalid_body',
        'curriculumLevel must be MATRIC, O_LEVELS, A_LEVELS or MIXED.',
        400,
      );
    }

    // Required on MIXED and meaningless off it. Enforced here rather than by a
    // CHECK constraint — see the column comment in `db/schema/branches.ts`.
    const boardName = readOptionalString(body.boardName);
    if (body.curriculumLevel === 'MIXED' && boardName === null) {
      return apiFailure(
        'invalid_body',
        'Name the board this campus follows. “Mixed” on its own does not say which.',
        400,
      );
    }

    const landline = readLandlineField(body.landline);
    if (!landline.ok) return apiFailure('invalid_body', landline.message, 400);

    const phone = readMobileField(body.phone);
    if (!phone.ok) return apiFailure('invalid_body', phone.message, 400);

    const email = readEmailField(body.email);
    if (!email.ok) return apiFailure('invalid_body', email.message, 400);

    const isMainBranch = body.isMainBranch === true;

    const inserted = await db
      .insert(branches)
      .values({
        locationId,
        name,
        code,
        city,
        address: readOptionalString(body.address),
        latitude: readCoordinate(body.latitude, 'latitude'),
        longitude: readCoordinate(body.longitude, 'longitude'),
        landline: landline.value,
        phone: phone.value,
        email: email.value,
        curriculumLevel: body.curriculumLevel,
        // Dropped rather than refused when it does not match the curriculum:
        // the operator changed the curriculum after ticking, which is a
        // correction, not an error.
        classLevels: sanitiseClassLevels(body.classLevels, body.curriculumLevel),
        boardName: body.curriculumLevel === 'MIXED' ? boardName : null,
        isMainBranch,
        isActive: body.isActive === false ? false : true,
      })
      // `code` is unique per school.
      .onConflictDoNothing()
      .returning();

    const branch = inserted[0];
    if (branch === undefined) {
      return apiFailure(
        'already_exists',
        'A branch with that code already exists for this school.',
        409,
      );
    }

    if (isMainBranch) {
      await demoteOtherMainBranches(locationId, branch.id);
    }

    /**
     * Optionally turn the branch's email into that campus's administrator.
     *
     * ── Why this is offered at all ───────────────────────────────────────
     * An operator who types an email address into a form reasonably expects
     * somebody to hear about it. Until now the branch email was a *contact*
     * field — printed on a challan, never mailed — so entering one and waiting
     * for an invitation was a silent no-op, and it was reported as exactly
     * that: "I create a Branch and enter email ID, the email is not being sent
     * to the user."
     *
     * ── Why it is a choice rather than automatic ─────────────────────────
     * Because it creates a *person* with access to the school, and some
     * branches genuinely have only a front-desk address that nobody should be
     * signing in with. The form asks; it does not assume.
     *
     * ── Why it needs the mobile too ──────────────────────────────────────
     * `school_users.phone` is NOT NULL and unique per school — it is how a
     * member is identified within a tenant. There is no way to write the row
     * without one, so the invitation is skipped and said to be skipped, rather
     * than failing the branch creation that already succeeded.
     */
    let invite: {
      created: boolean;
      emailQueued: boolean;
      reason: string | null;
    } = { created: false, emailQueued: false, reason: null };

    if (body.inviteAsBranchAdmin === true) {
      if (email.value === null) {
        invite = { created: false, emailQueued: false, reason: 'No email address was given for this branch.' };
      } else if (phone.value === null) {
        invite = {
          created: false,
          emailQueued: false,
          reason:
            'A mobile number is needed as well as an email — it is how a member is identified within a school. Add one and invite them from the Users tab.',
        };
      } else {
        const member = await createFirstSchoolAdmin(db, {
          locationId,
          name: `${name} administrator`,
          phone: phone.value,
          email: email.value,
          role: 'branch_admin',
          branchId: branch.id,
        });

        if (member.status === 'created') {
          const access = await queueAccessEmail({
            locationId,
            school: { name: schoolRow.name, slug: schoolRow.slug },
            member: {
              id: member.userId,
              name: `${name} administrator`,
              email: email.value,
              authUserId: null,
            },
            createdBy: session.email,
          });

          invite = {
            created: true,
            emailQueued: access.queued,
            reason: access.queued ? null : access.reason,
          };
        } else {
          invite = {
            created: false,
            emailQueued: false,
            reason:
              member.status === 'exists'
                ? 'Somebody at this school already uses that mobile number, so no new administrator was created.'
                : member.reason,
          };
        }
      }
    }

    return apiSuccess({ branch, invite }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}

