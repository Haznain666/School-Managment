import { randomUUID } from 'node:crypto';

import { and, desc, eq, ilike, or, type SQL } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { schools } from '@/db/schema';
import { queueAccessEmail } from '@/lib/access-email';
import { seedChartOfAccounts } from '@/lib/accounting-queries';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { isPakistaniCity } from '@/lib/cities';
import { db } from '@/lib/drizzle';
import {
  readCoordinate,
  readEmailField,
  readLandlineField,
  readMobileField,
} from '@/lib/profile-fields';
import { provisionSchoolSubdomain } from '@/lib/hostinger';
import { createFirstSchoolAdmin, seedResultSubcategories } from '@/lib/school-bootstrap';
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
  latitude?: unknown;
  longitude?: unknown;
  landline?: unknown;
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
    // Captured so the administrator's setup token records who issued it.
    const session = await requireSuperAdmin();

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

    const landline = readLandlineField(body.landline);
    if (!landline.ok) return apiFailure('invalid_body', landline.message, 400);

    const phone = readMobileField(body.phone);
    if (!phone.ok) return apiFailure('invalid_body', phone.message, 400);

    const email = readEmailField(body.email);
    if (!email.ok) return apiFailure('invalid_body', email.message, 400);

    const adminEmail = readEmailField(body.adminEmail);
    if (!adminEmail.ok) return apiFailure('invalid_body', adminEmail.message, 400);

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
        latitude: readCoordinate(body.latitude, 'latitude'),
        longitude: readCoordinate(body.longitude, 'longitude'),
        landline: landline.value,
        phone: phone.value,
        email: email.value,
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
     * Give the school its books before anything can post to them.
     *
     * Sprint 13.5. The chart of accounts is what a fee payment lands in, so a
     * school without one takes money that reaches no ledger — and the person
     * who would discover that is a clerk at a counter, weeks later. Seeding it
     * here is what makes migration `0027`'s backfill a one-off rather than a
     * thing every new school needs.
     *
     * Like the administrator below, it does not fail the request: the school
     * row is committed and useful, and an empty chart is recoverable in one
     * click from the accounting screen. It is logged rather than swallowed
     * silently, because a school that quietly has no books is exactly the state
     * nobody would go looking for.
     */
    try {
      await seedChartOfAccounts(school.locationId);
    } catch (error) {
      console.error('[super-admin] chart of accounts could not be seeded:', error);
    }

    /*
     * And the four performance descriptors, for the same reason and on the same
     * terms. Sprint 14: migration `0029` seeded every school that existed when
     * it ran, so this is what keeps a school provisioned afterwards identical
     * to one provisioned before. Logged rather than swallowed — a school whose
     * descriptor picker is quietly empty is a state nobody would go looking for.
     */
    try {
      await seedResultSubcategories(school.locationId);
    } catch (error) {
      console.error('[super-admin] result sub-categories could not be seeded:', error);
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
    const adminName = readString(body.adminName) || readString(body.principalName);
    const adminAddress = adminEmail.value ?? email.value;

    const admin = await createFirstSchoolAdmin(db, {
      locationId: school.locationId,
      name: adminName,
      phone: readString(body.adminPhone) || readString(body.phone),
      email: adminAddress,
    });

    /**
     * Mail the administrator their password-setup link.
     *
     * ── The defect this closes ───────────────────────────────────────────
     * Creating a school created its first administrator and then sent them
     * nothing. Every *other* path that mints a member queues this same message
     * — `POST .../users` does it, and so does the branch form — so the one
     * route that provisions the very first person into a school was the only
     * one leaving them with an account and no way to reach it. The reported
     * symptom was the account existing, the operator moving on, and the
     * administrator receiving only whatever Supabase happened to send.
     *
     * `authUserId: null` is passed deliberately rather than read back: the row
     * was created moments ago and has never been through setup, so this is
     * always the first-time email carrying a `/set-password/<token>` link, not
     * the "here is where to sign in" reminder.
     *
     * A failure does not fail the request, for the same reason the
     * administrator itself does not: the school and the member are both
     * committed and useful, and the commonest cause is the platform's own SMTP.
     * The outcome is returned so the panel can say plainly what happened.
     */
    const adminAccess =
      admin.status === 'created'
        ? await queueAccessEmail({
            locationId: school.locationId,
            school: { name: school.name, slug: school.slug },
            member: {
              id: admin.userId,
              name: adminName,
              email: adminAddress,
              authUserId: null,
            },
            createdBy: session.email,
          })
        : null;

    /**
     * Provision `<slug>.<PLATFORM_BASE_DOMAIN>` at the host.
     *
     * Same contract as the administrator above, and for a stronger reason: this
     * one calls a third party. A hosting API outage must not be able to stop a
     * school being created, so the failure is recorded on the row and offered
     * for retry rather than raised. `lib/hostinger.ts` never throws for exactly
     * this reason — see its docblock.
     *
     * The status is written in a second statement rather than folded into the
     * insert, because the provisioning call has to happen *after* the row is
     * committed: a school that failed to insert has no subdomain to create.
     */
    const provision = await provisionSchoolSubdomain(school.slug);

    const [withStatus] = await db
      .update(schools)
      .set({
        subdomainStatus: provision.status,
        subdomainError: provision.status === 'failed' ? provision.message : null,
        subdomainProvisionedAt:
          provision.status === 'failed' || provision.status === 'unmanaged'
            ? null
            : new Date(),
      })
      .where(eq(schools.id, school.id))
      .returning();

    return apiSuccess(
      {
        school: withStatus ?? school,
        admin,
        adminEmail: {
          queued: adminAccess?.queued ?? false,
          problem: adminAccess === null || adminAccess.queued ? null : adminAccess.reason,
        },
        subdomain: {
          host: provision.fqdn,
          status: provision.status,
          message: provision.message,
        },
      },
      201,
    );
  } catch (error) {
    return handleApiError(error);
  }
}
