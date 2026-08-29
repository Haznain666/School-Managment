import { asc, eq } from 'drizzle-orm';

import { branches, isCurriculumLevel } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { withSchoolAuth } from '@/lib/api-auth';
import { sanitiseClassLevels } from '@/lib/branch-classes';
import {
  applyBranchLead,
  describeBranchLead,
  readBranchLead,
} from '@/lib/branch-leads';
import { demoteOtherMainBranches } from '@/lib/branches';
import { isPakistaniCity } from '@/lib/cities';
import { db } from '@/lib/drizzle';
import {
  readCoordinate,
  readEmailField,
  readLandlineField,
  readMobileField,
} from '@/lib/profile-fields';
import { listBranchOptions } from '@/lib/school-queries';
import { readOptionalString, readString } from '@/lib/validation';
import { USER_ROLES } from '@/types/school-auth';

/**
 * GET  /api/school/branches — active campuses of the caller's own school.
 * POST /api/school/branches — create a campus.
 *
 * ── Why POST exists here now ─────────────────────────────────────────────
 * Branches used to be creatable only from the Super Admin panel, and this file
 * said so. That left a school whose first campus had never been entered with no
 * way out from the inside: Invite Staff asks for a branch, every role worth
 * inviting first requires one, and the one screen that could supply it was
 * behind a login the school does not have. The school administrator had to mail
 * the platform operator and wait.
 *
 * So a school can now create its own campuses. The Super Admin route is
 * unchanged and still exists — an operator setting a school up over the phone
 * is a real workflow — and the two write the same table under the same rules.
 *
 * ── It now answers "who runs this campus" too (Sprint 19a, item 3) ───────
 * This route used to refuse to create a member on principle: the administrator
 * making the branch was already signed in, and Invite Staff was one screen
 * away. That was right about the *old* control, which could only invite the
 * campus's own email address and produced an account named after the building.
 *
 * It is wrong about the new one. A school group creating its third campus is
 * answering "who runs it" in the same breath as "where is it", and making them
 * do it on a second screen is how a campus ends up with nobody in it — which is
 * a campus whose staff cannot be invited and whose fees nobody can raise.
 *
 * Both routes now read the *same validator*, `lib/branch-leads.ts`. Neither
 * has its own copy of the rules, and neither can drift from the form.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (_request, auth) => {
    try {
      return apiSuccess({ branches: await listBranchOptions(auth.locationId) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: USER_ROLES },
);

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
  /** Who runs this campus. Validated by `lib/branch-leads.ts`. */
  branchAdmin?: unknown;
  branchPrincipal?: unknown;
}

/**
 * Gated on `settings.write` rather than a branch permission of its own.
 *
 * A campus is school-level configuration — the same class of decision as the
 * school's profile, its logo and its palette — and by default only
 * `school_admin` holds that key. Giving branches a permission of their own
 * would mean a migration and a new row in the matrix for a distinction no
 * school has asked to draw; `lib/permissions.ts` makes the same argument about
 * delete.
 */
export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<CreateBranchBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      // Read before the branch is written: an unusable answer is a 400, not a
      // created campus with a half-applied administrator behind it.
      const branchAdmin = readBranchLead(body.branchAdmin);
      if (typeof branchAdmin === 'string') {
        return apiFailure('invalid_body', branchAdmin, 400);
      }

      const branchPrincipal = readBranchLead(body.branchPrincipal);
      if (typeof branchPrincipal === 'string') {
        return apiFailure('invalid_body', branchPrincipal, 400);
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

      // Required on MIXED and meaningless off it — the same rule the Super
      // Admin route enforces, for the reason given in `db/schema/branches.ts`.
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

      const wantsMainBranch = body.isMainBranch === true;

      const inserted = await db
        .insert(branches)
        .values({
          // Always from the verified session, never from the body — that is
          // what keeps one school out of another's branch list.
          locationId: auth.locationId,
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
          classLevels: sanitiseClassLevels(body.classLevels, body.curriculumLevel),
          boardName: body.curriculumLevel === 'MIXED' ? boardName : null,
          isMainBranch: wantsMainBranch,
          isActive: true,
        })
        // `code` is unique per school.
        .onConflictDoNothing()
        .returning();

      const branch = inserted[0];
      if (branch === undefined) {
        return apiFailure(
          'already_exists',
          'A branch with that code already exists at this school.',
          409,
        );
      }

      /**
       * The first campus is the main one whether or not the toggle was set.
       *
       * A school with exactly one branch and no main branch is a state nobody
       * chooses and which quietly breaks everything that asks for the main
       * campus — a challan header, a report footer. Counted from the table
       * after the insert rather than assumed from the empty list the form was
       * rendered with, which may be a minute old.
       */
      const rows = await db
        .select({ id: branches.id })
        .from(branches)
        .where(eq(branches.locationId, auth.locationId))
        .orderBy(asc(branches.id));

      const isOnlyBranch = rows.length === 1;
      const isMainBranch = wantsMainBranch || isOnlyBranch;

      if (isMainBranch) {
        if (!wantsMainBranch) {
          await db
            .update(branches)
            .set({ isMainBranch: true })
            .where(eq(branches.id, branch.id));
        }

        await demoteOtherMainBranches(auth.locationId, branch.id);
      }

      // After the campus is committed, and never allowed to fail it. See the
      // Super Admin route for the argument at length.
      const leads = [
        await applyBranchLead('admin', branchAdmin, {
          locationId: auth.locationId,
          branchId: branch.id,
          branchName: name,
          actor: auth.uid,
        }),
        await applyBranchLead('principal', branchPrincipal, {
          locationId: auth.locationId,
          branchId: branch.id,
          branchName: name,
          actor: auth.uid,
        }),
      ].filter((outcome) => outcome !== null);

      return apiSuccess(
        {
          branch: { ...branch, isMainBranch },
          leads,
          notes: leads.map((outcome) => describeBranchLead(outcome)),
        },
        201,
      );
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'settings.write' },
);
