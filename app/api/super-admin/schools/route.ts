import { randomUUID } from 'node:crypto';

import { and, desc, eq, ilike, or, type SQL } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { schools } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { isPakistaniCity } from '@/lib/cities';
import { db } from '@/lib/drizzle';
import { createFirstSchoolAdmin } from '@/lib/school-bootstrap';
import { deriveSchoolCode, schoolCodeRejectionReason } from '@/lib/school-code';
import { slugRejectionReason } from '@/lib/slug';
import { requireSuperAdmin } from '@/lib/super-admin-guard';
import { readOptionalString, readString } from '@/lib/validation';

/**
 * /api/super-admin/schools — the tenant directory, Super Admin side.
 *
 * GET  lists schools with search and active filtering.
 * POST provisions a new tenant.
 *
 * Unlike the school-facing API there is no tenant filter here: the Super Admin
 * legitimately operates across every school. The gate is the session cookie,
 * checked both by middleware and again by `requireSuperAdmin()`.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    await requireSuperAdmin();

    const url = new URL(request.url);
    const search = readString(url.searchParams.get('search'));
    const status = url.searchParams.get('status');

    const conditions: SQL[] = [];

    if (search !== '') {
      const pattern = `%${search}%`;
      const matches = or(
        ilike(schools.name, pattern),
        ilike(schools.city, pattern),
        ilike(schools.slug, pattern),
      );
      if (matches !== undefined) conditions.push(matches);
    }

    if (status === 'active') conditions.push(eq(schools.isActive, true));
    if (status === 'inactive') conditions.push(eq(schools.isActive, false));

    const rows = await db
      .select()
      .from(schools)
      .where(conditions.length === 0 ? undefined : and(...conditions))
      .orderBy(desc(schools.createdAt));

    return apiSuccess({ schools: rows });
  } catch (error) {
    return handleApiError(error);
  }
}

interface CreateSchoolBody {
  name?: unknown;
  slug?: unknown;
  schoolCode?: unknown;
  city?: unknown;
  address?: unknown;
  phone?: unknown;
  email?: unknown;
  principalName?: unknown;
  /** First administrator. Falls back to the principal's details when absent. */
  adminName?: unknown;
  adminPhone?: unknown;
  adminEmail?: unknown;
}

export async function POST(request: NextRequest) {
  try {
    await requireSuperAdmin();

    const body = await readJsonBody<CreateSchoolBody>(request);
    if (body === null) {
      return apiFailure('invalid_body', 'Expected a JSON body.', 400);
    }

    const name = readString(body.name);
    const slug = readString(body.slug).toLowerCase();
    const city = readString(body.city);

    if (name === '') {
      return apiFailure('invalid_body', 'School name is required.', 400);
    }

    const slugProblem = slugRejectionReason(slug);
    if (slugProblem !== null) {
      return apiFailure('invalid_slug', slugProblem, 400);
    }

    if (!isPakistaniCity(city)) {
      return apiFailure('invalid_body', 'Select a city from the list.', 400);
    }

    // The code prefixes every student ID this school ever issues, so it is
    // derived from the name rather than left null when nobody supplies one —
    // a school with no code cannot enrol anyone.
    const schoolCodeInput = readString(body.schoolCode).toUpperCase();
    const codeProblem = schoolCodeRejectionReason(schoolCodeInput);
    if (codeProblem !== null) {
      return apiFailure('invalid_body', codeProblem, 400);
    }

    const schoolCode =
      schoolCodeInput === '' ? deriveSchoolCode(name) : schoolCodeInput;

    /**
     * The school owns its tenant identity.
     *
     * `location_id` used to be the GoHighLevel Location ID, which made a GHL
     * sub-account a prerequisite for existing. It is now the school's own id,
     * generated here rather than defaulted in the database so that both
     * columns can be given the same value in one insert.
     *
     * GHL, when a school wants it, is connected afterwards from the Super
     * Admin panel and lands in `ghl_location_id`.
     */
    const id = randomUUID();

    const inserted = await db
      .insert(schools)
      .values({
        id,
        name,
        slug,
        locationId: id,
        schoolCode,
        city,
        address: readOptionalString(body.address),
        phone: readOptionalString(body.phone),
        email: readOptionalString(body.email),
        principalName: readOptionalString(body.principalName),
      })
      // `slug` is unique. `location_id` is a fresh uuid and cannot clash, so a
      // conflict here means the subdomain is taken.
      .onConflictDoNothing()
      .returning();

    const school = inserted[0];
    if (school === undefined) {
      return apiFailure('already_exists', 'That subdomain is already registered.', 409);
    }

    /**
     * Provision the first administrator alongside the school.
     *
     * Without this, a new school is unreachable: every other way to create a
     * member requires a member to already be signed in. The principal's details
     * are the fallback because they are what an operator has typically just
     * typed, but `adminPhone` lets them name someone else.
     *
     * This deliberately does not fail the request. The school row is already
     * committed and is useful on its own, and the most common reason for
     * skipping — the school's number being a landline — is not an error the
     * operator should have to undo a provisioning over. The outcome is reported
     * so the UI can say what happened.
     */
    const admin = await createFirstSchoolAdmin(db, {
      locationId: school.locationId,
      name: readString(body.adminName) || readString(body.principalName),
      phone: readString(body.adminPhone) || readString(body.phone),
      email: readOptionalString(body.adminEmail) ?? readOptionalString(body.email),
    });

    return apiSuccess({ school, admin }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
