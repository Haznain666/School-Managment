import type { NextRequest } from 'next/server';

import { apiSuccess, handleApiError } from '@/lib/api-response';
import { searchForPlatform } from '@/lib/portal-search';
import { requireSuperAdmin } from '@/lib/super-admin-guard';

/**
 * GET /api/super-admin/search?q=… — the platform's global search.
 *
 * Cross-tenant, like everything on this surface, and behind `requireSuperAdmin`
 * for exactly that reason. No query parameter narrows it to one school: the
 * operator's question is usually "which school is this person at", and a school
 * filter would presuppose the answer.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    await requireSuperAdmin();

    return apiSuccess(
      await searchForPlatform(request.nextUrl.searchParams.get('q') ?? ''),
    );
  } catch (error) {
    return handleApiError(error);
  }
}
