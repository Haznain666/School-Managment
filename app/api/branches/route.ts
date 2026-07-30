import { and, eq, type SQL } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { branches, SECONDARY_PATHS, type SecondaryPath } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { requireRole, withAuth } from '@/lib/auth-middleware';
import { db } from '@/lib/drizzle';

/**
 * /api/branches — campuses within one school.
 *
 * Every query is filtered by `auth.locationId` (CRITICAL RULE #3). Users who
 * are pinned to a single branch see only that branch.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isSecondaryPath(value: unknown): value is SecondaryPath {
  return (
    typeof value === 'string' && (SECONDARY_PATHS as readonly string[]).includes(value)
  );
}

export async function GET(request: NextRequest) {
  try {
    const auth = await withAuth(request);

    const conditions: SQL[] = [eq(branches.locationId, auth.locationId)];

    // branch_id = null in claims means "all branches of this school".
    if (auth.branchId !== null) {
      conditions.push(eq(branches.id, auth.branchId));
    }

    const rows = await db
      .select({
        id: branches.id,
        name: branches.name,
        city: branches.city,
        secondaryPath: branches.secondaryPath,
        address: branches.address,
        phone: branches.phone,
        status: branches.status,
        createdAt: branches.createdAt,
      })
      .from(branches)
      .where(and(...conditions));

    return apiSuccess({ branches: rows });
  } catch (error) {
    return handleApiError(error);
  }
}

interface CreateBranchBody {
  name?: unknown;
  city?: unknown;
  secondaryPath?: unknown;
  address?: unknown;
  phone?: unknown;
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRole(request, [
      'school_admin',
      'principal',
      'vice_principal',
    ]);

    const body = await readJsonBody<CreateBranchBody>(request);
    if (body === null) {
      return apiFailure('invalid_body', 'Expected a JSON body.', 400);
    }

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const city = typeof body.city === 'string' ? body.city.trim() : '';

    if (name === '' || city === '') {
      return apiFailure('invalid_body', 'name and city are required.', 400);
    }

    if (body.secondaryPath !== undefined && !isSecondaryPath(body.secondaryPath)) {
      return apiFailure(
        'invalid_body',
        `secondaryPath must be one of: ${SECONDARY_PATHS.join(', ')}.`,
        400,
      );
    }

    const inserted = await db
      .insert(branches)
      .values({
        // Tenant comes from the verified token, never from the body.
        locationId: auth.locationId,
        name,
        city,
        secondaryPath: isSecondaryPath(body.secondaryPath) ? body.secondaryPath : null,
        address: typeof body.address === 'string' ? body.address : null,
        phone: typeof body.phone === 'string' ? body.phone : null,
      })
      .returning({
        id: branches.id,
        name: branches.name,
        city: branches.city,
        secondaryPath: branches.secondaryPath,
        status: branches.status,
      });

    return apiSuccess({ branch: inserted[0] }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
