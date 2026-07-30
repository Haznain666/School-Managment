import { eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { schools } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { withAuth } from '@/lib/auth-middleware';
import { db } from '@/lib/drizzle';

/**
 * /api/schools — the school-facing view of the tenant directory.
 *
 * A signed-in school user reads their own school and nothing else: the filter
 * comes from `auth.locationId`, their verified claim, and no request parameter
 * can change it.
 *
 * Provisioning schools is a platform operation and lives in the Super Admin
 * API (`/api/super-admin/schools`), which is gated by the operator session
 * rather than by Firebase claims.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const auth = await withAuth(request);

    const columns = {
      id: schools.id,
      slug: schools.slug,
      locationId: schools.locationId,
      name: schools.name,
      city: schools.city,
      address: schools.address,
      phone: schools.phone,
      email: schools.email,
      principalName: schools.principalName,
      logoUrl: schools.logoUrl,
      isActive: schools.isActive,
      createdAt: schools.createdAt,
    };

    const rows =
      auth.role === 'super_admin'
        ? await db.select(columns).from(schools)
        : await db
            .select(columns)
            .from(schools)
            .where(eq(schools.locationId, auth.locationId));

    return apiSuccess({ schools: rows });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST() {
  // Kept explicit so a stale client gets a clear pointer rather than a 405.
  return apiFailure(
    'moved',
    'Schools are provisioned from the Super Admin panel (/api/super-admin/schools).',
    405,
  );
}
