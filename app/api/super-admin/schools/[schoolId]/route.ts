import { and, eq, ne } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { schools } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { isPakistaniCity } from '@/lib/cities';
import { db } from '@/lib/drizzle';
import { releaseSchoolAuthAccounts } from '@/lib/school-queries';
import {
  readCoordinate,
  readEmailField,
  readLandlineField,
  readMobileField,
} from '@/lib/profile-fields';
import { deriveSchoolCode, schoolCodeRejectionReason } from '@/lib/school-code';
import { slugRejectionReason } from '@/lib/slug';
import { requireSuperAdmin } from '@/lib/super-admin-guard';
import { isUuid, readOptionalString, readString } from '@/lib/validation';

/**
 * /api/super-admin/schools/[schoolId]
 *
 * GET    one school
 * PATCH  update (partial — only supplied fields change)
 * DELETE soft delete, i.e. `is_active = false`
 *
 * Deletion is deliberately soft: a school's students, staff and fee history
 * hang off its location_id, and a hard delete would cascade all of it away.
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

    const rows = await db.select().from(schools).where(eq(schools.id, schoolId)).limit(1);
    const school = rows[0];

    if (school === undefined) {
      return apiFailure('not_found', 'School not found.', 404);
    }

    return apiSuccess({ school });
  } catch (error) {
    return handleApiError(error);
  }
}

interface UpdateSchoolBody {
  name?: unknown;
  slug?: unknown;
  schoolCode?: unknown;
  city?: unknown;
  address?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  landline?: unknown;
  phone?: unknown;
  email?: unknown;
  principalName?: unknown;
  isActive?: unknown;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    await requireSuperAdmin();

    const { schoolId } = await context.params;
    if (!isUuid(schoolId)) {
      return apiFailure('not_found', 'School not found.', 404);
    }

    const body = await readJsonBody<UpdateSchoolBody>(request);
    if (body === null) {
      return apiFailure('invalid_body', 'Expected a JSON body.', 400);
    }

    const updates: Partial<typeof schools.$inferInsert> = {};

    if (body.name !== undefined) {
      const name = readString(body.name);
      if (name === '') {
        return apiFailure('invalid_body', 'School name cannot be empty.', 400);
      }
      updates.name = name;
    }

    if (body.slug !== undefined) {
      const slug = readString(body.slug).toLowerCase();
      const problem = slugRejectionReason(slug);
      if (problem !== null) {
        return apiFailure('invalid_slug', problem, 400);
      }

      const clash = await db
        .select({ id: schools.id })
        .from(schools)
        .where(and(eq(schools.slug, slug), ne(schools.id, schoolId)))
        .limit(1);

      if (clash[0] !== undefined) {
        return apiFailure('already_exists', 'That subdomain is already taken.', 409);
      }

      updates.slug = slug;
    }

    if (body.schoolCode !== undefined) {
      const schoolCode = readString(body.schoolCode).toUpperCase();
      const problem = schoolCodeRejectionReason(schoolCode);
      if (problem !== null) {
        return apiFailure('invalid_body', problem, 400);
      }

      if (schoolCode !== '') {
        updates.schoolCode = schoolCode;
      } else {
        // Blank derives a code rather than clearing it: a school with none
        // cannot issue student IDs, so there is nothing useful about null here.
        const existing = await db
          .select({ name: schools.name })
          .from(schools)
          .where(eq(schools.id, schoolId))
          .limit(1);

        const sourceName = updates.name ?? existing[0]?.name;
        if (sourceName !== undefined) {
          updates.schoolCode = deriveSchoolCode(sourceName);
        }
      }
    }

    if (body.city !== undefined) {
      const city = readString(body.city);
      if (!isPakistaniCity(city)) {
        return apiFailure('invalid_body', 'Select a city from the list.', 400);
      }
      updates.city = city;
    }

    if (body.address !== undefined) updates.address = readOptionalString(body.address);
    if (body.latitude !== undefined) {
      updates.latitude = readCoordinate(body.latitude, 'latitude');
    }
    if (body.longitude !== undefined) {
      updates.longitude = readCoordinate(body.longitude, 'longitude');
    }

    if (body.landline !== undefined) {
      const landline = readLandlineField(body.landline);
      if (!landline.ok) return apiFailure('invalid_body', landline.message, 400);
      updates.landline = landline.value;
    }

    if (body.phone !== undefined) {
      const phone = readMobileField(body.phone);
      if (!phone.ok) return apiFailure('invalid_body', phone.message, 400);
      updates.phone = phone.value;
    }

    if (body.email !== undefined) {
      const email = readEmailField(body.email);
      if (!email.ok) return apiFailure('invalid_body', email.message, 400);
      updates.email = email.value;
    }
    if (body.principalName !== undefined) {
      updates.principalName = readOptionalString(body.principalName);
    }
    if (typeof body.isActive === 'boolean') updates.isActive = body.isActive;

    if (Object.keys(updates).length === 0) {
      return apiFailure('invalid_body', 'No fields to update.', 400);
    }

    updates.updatedAt = new Date();

    // The GHL Location ID is deliberately not updatable: it is the tenant key
    // that every other table's rows are filed under.
    const updated = await db
      .update(schools)
      .set(updates)
      .where(eq(schools.id, schoolId))
      .returning();

    const school = updated[0];
    if (school === undefined) {
      return apiFailure('not_found', 'School not found.', 404);
    }

    return apiSuccess({ school });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * DELETE /api/super-admin/schools/[schoolId]
 *
 * Deactivates by default. Erases the tenant outright with `?permanent=true`.
 *
 * ── Why two behaviours behind one verb ───────────────────────────────────
 * Deactivating is what an operator wants almost every time: a school that has
 * stopped paying, or is between sessions, or was set up wrongly and is being
 * rebuilt. Its portal closes, its data stays, and it comes back with one press.
 * That stays the default precisely so nobody reaches the destructive one by
 * accident or by habit.
 *
 * Permanent deletion is for the cases deactivation cannot serve: a tenant
 * created by mistake, a duplicate, a test school on a live estate, or a school
 * that has left and has asked for its records to be erased. Before this
 * existed the only way to do any of those was SQL against production, which is
 * strictly worse — unlogged, unreviewed, and with no cascade guarantees anyone
 * had checked.
 *
 * ── What "permanent" actually removes ────────────────────────────────────
 * Every one of the 61 foreign keys pointing at `schools.location_id` is
 * `ON DELETE CASCADE`, so a single DELETE takes the branches, students, staff,
 * enrolments, fee challans, payments, exams, results, payroll, announcements
 * and everything else with it. That was verified against the schema, not
 * assumed. There is no soft-delete residue and no orphan.
 *
 * The Supabase accounts are removed too, but only for members who belong to no
 * other school — one Supabase account is one human, and a parent with children
 * at two schools must not be locked out of the second because the first was
 * deleted. Same rule as `deleteSchoolMember`, and the reason it is applied
 * here explicitly is that a cascade deletes `school_users` rows without any
 * application code running.
 *
 * ── The confirmation is the school's own name ────────────────────────────
 * `confirmName` must match exactly. A yes/no dialog is muscle memory by the
 * third time an operator sees it; typing the name cannot be done absent-mindedly
 * and cannot be done at all on the wrong row, which is the mistake actually
 * worth preventing. It is checked here rather than only in the UI because the
 * UI is not the only caller this route will ever have.
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    await requireSuperAdmin();

    const { schoolId } = await context.params;
    if (!isUuid(schoolId)) {
      return apiFailure('not_found', 'School not found.', 404);
    }

    const permanent =
      new URL(request.url).searchParams.get('permanent') === 'true';

    if (!permanent) {
      const updated = await db
        .update(schools)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(schools.id, schoolId))
        .returning({ id: schools.id, isActive: schools.isActive });

      const school = updated[0];
      if (school === undefined) {
        return apiFailure('not_found', 'School not found.', 404);
      }

      return apiSuccess({ school, deactivated: true });
    }

    const existing = await db
      .select({
        id: schools.id,
        name: schools.name,
        slug: schools.slug,
        locationId: schools.locationId,
      })
      .from(schools)
      .where(eq(schools.id, schoolId))
      .limit(1);

    const school = existing[0];
    if (school === undefined) {
      return apiFailure('not_found', 'School not found.', 404);
    }

    const body = await readJsonBody<{ confirmName?: unknown }>(request);
    const confirmName = readString(body?.confirmName);

    if (confirmName !== school.name) {
      return apiFailure(
        'confirmation_required',
        `To delete this school permanently, send its exact name as confirmName. Expected “${school.name}”.`,
        400,
      );
    }

    // Collected before the cascade, because afterwards there is no row left to
    // say which addresses belonged to this tenant.
    const released = await releaseSchoolAuthAccounts(school.locationId);

    await db.delete(schools).where(eq(schools.id, schoolId));

    console.warn(
      `[super-admin] school "${school.name}" (${school.slug}) was permanently ` +
        `deleted along with all of its data; ${released} Supabase account(s) released`,
    );

    return apiSuccess({
      deleted: true,
      name: school.name,
      slug: school.slug,
      authAccountsReleased: released,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
