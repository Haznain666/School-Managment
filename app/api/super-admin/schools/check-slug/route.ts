import { and, eq, ne } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { schools } from '@/db/schema';
import { apiSuccess, handleApiError } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { slugRejectionReason } from '@/lib/slug';
import { requireSuperAdmin } from '@/lib/super-admin-guard';
import { isUuid, readString } from '@/lib/validation';

/**
 * GET /api/super-admin/schools/check-slug?slug=xxx[&excludeSchoolId=uuid]
 *
 * Powers the live availability check on the school form. `excludeSchoolId`
 * lets the edit form keep its own current slug without reporting a clash.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    await requireSuperAdmin();

    const url = new URL(request.url);
    const slug = readString(url.searchParams.get('slug')).toLowerCase();
    const excludeSchoolId = url.searchParams.get('excludeSchoolId');

    // Format failures are reported as unavailable with a reason, so the form
    // has one code path for "you cannot use this".
    const problem = slugRejectionReason(slug);
    if (problem !== null) {
      return apiSuccess({ available: false, reason: problem });
    }

    const conditions = [eq(schools.slug, slug)];
    if (isUuid(excludeSchoolId)) {
      conditions.push(ne(schools.id, excludeSchoolId));
    }

    const taken = await db
      .select({ id: schools.id })
      .from(schools)
      .where(and(...conditions))
      .limit(1);

    return taken[0] === undefined
      ? apiSuccess({ available: true, reason: null })
      : apiSuccess({ available: false, reason: 'That subdomain is already taken.' });
  } catch (error) {
    return handleApiError(error);
  }
}
