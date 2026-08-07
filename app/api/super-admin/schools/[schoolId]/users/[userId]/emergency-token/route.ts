import { randomBytes } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import {
  emergencyExpiryFromNow,
  emergencyLoginTokens,
  schoolUsers,
  schools,
} from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { serverEnv } from '@/lib/env';
import { requireSuperAdmin } from '@/lib/super-admin-guard';
import { isUuid } from '@/lib/validation';

/**
 * POST /api/super-admin/schools/[schoolId]/users/[userId]/emergency-token
 *
 * Issues a single-use sign-in link for one user, valid for fifteen minutes.
 *
 * This is the manual override for the case where both passcode channels have
 * failed. It bypasses possession-of-handset entirely, so it is the most
 * dangerous credential the platform can mint: only a Super Admin can issue it,
 * it names exactly one user at one school, and every issuance leaves a row
 * behind.
 *
 * The URL is returned to the operator and never written to the server log.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ schoolId: string; userId: string }> };

/** Absolute URL the recipient opens; dev has no subdomain, so slug is a query. */
function buildEmergencyUrl(token: string, slug: string): string {
  const base = serverEnv('INVITE_LINK_BASE_URL', '').trim();
  const isDevelopment = process.env.NODE_ENV === 'development';

  if (isDevelopment || base === '') {
    const origin = base === '' ? 'http://localhost:3000' : base;
    return `${origin.replace(/\/+$/, '')}/emergency-login/${token}?school=${encodeURIComponent(slug)}`;
  }

  const url = new URL(base);
  const baseDomain = serverEnv('PLATFORM_BASE_DOMAIN', url.hostname);
  url.hostname = `${slug}.${baseDomain}`;
  url.pathname = `/emergency-login/${token}`;
  return url.toString();
}

export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireSuperAdmin();

    const { schoolId, userId } = await context.params;
    if (!isUuid(schoolId) || !isUuid(userId)) {
      return apiFailure('not_found', 'User not found.', 404);
    }

    const schoolRows = await db
      .select({ locationId: schools.locationId, slug: schools.slug })
      .from(schools)
      .where(eq(schools.id, schoolId))
      .limit(1);

    const school = schoolRows[0];
    if (school === undefined) {
      return apiFailure('not_found', 'School not found.', 404);
    }

    const userRows = await db
      .select({
        id: schoolUsers.id,
        name: schoolUsers.name,
        role: schoolUsers.role,
        authUserId: schoolUsers.authUserId,
        isActive: schoolUsers.isActive,
      })
      .from(schoolUsers)
      .where(
        and(
          eq(schoolUsers.id, userId),
          // Tenant check: a user id from another school is not reachable here.
          eq(schoolUsers.locationId, school.locationId),
        ),
      )
      .limit(1);

    const user = userRows[0];
    if (user === undefined) {
      return apiFailure('not_found', 'User not found.', 404);
    }

    if (user.authUserId === null) {
      return apiFailure(
        'no_account',
        'User has not accepted their invite yet. No Firebase account to log in as.',
        400,
      );
    }

    if (!user.isActive) {
      return apiFailure(
        'account_disabled',
        'This account is deactivated. Reactivate it before issuing an emergency link.',
        409,
      );
    }

    const token = randomBytes(32).toString('hex');
    // Computed once so the stored deadline and the one shown to the operator
    // are the same instant.
    const expiresAt = emergencyExpiryFromNow();

    await db.insert(emergencyLoginTokens).values({
      locationId: school.locationId,
      schoolUserId: user.id,
      authUserId: user.authUserId,
      token,
      createdBy: session.email,
      expiresAt,
    });

    return apiSuccess({
      token,
      url: buildEmergencyUrl(token, school.slug),
      expiresAt: expiresAt.toISOString(),
      userName: user.name,
      userRole: user.role,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
