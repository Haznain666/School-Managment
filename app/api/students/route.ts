import { and, asc, eq, type SQL } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { branches, students } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import {
  assertBranchAccess,
  requireRole,
  withAuth,
} from '@/lib/auth-middleware';
import { db } from '@/lib/drizzle';

/**
 * /api/students — student records for one school.
 *
 * Two layers of scoping:
 *   1. location_id from the caller's claims (tenant isolation)
 *   2. branch_id from the caller's claims, when they are pinned to a branch
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_PAGE_SIZE = 100;

export async function GET(request: NextRequest) {
  try {
    const auth = await withAuth(request);

    const url = new URL(request.url);
    const requestedBranchId = url.searchParams.get('branchId');
    const rawLimit = Number.parseInt(url.searchParams.get('limit') ?? '', 10);
    const limit =
      Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(rawLimit, MAX_PAGE_SIZE)
        : 50;

    const conditions: SQL[] = [eq(students.locationId, auth.locationId)];

    if (auth.branchId !== null) {
      // A branch-scoped user is confined to their branch regardless of what
      // they ask for.
      conditions.push(eq(students.branchId, auth.branchId));
    } else if (requestedBranchId !== null && requestedBranchId !== '') {
      conditions.push(eq(students.branchId, requestedBranchId));
    }

    const rows = await db
      .select({
        id: students.id,
        admissionNumber: students.admissionNumber,
        firstName: students.firstName,
        lastName: students.lastName,
        className: students.className,
        section: students.section,
        guardianName: students.guardianName,
        guardianPhone: students.guardianPhone,
        status: students.status,
        branchId: students.branchId,
        branchName: branches.name,
      })
      .from(students)
      .leftJoin(branches, eq(branches.id, students.branchId))
      .where(and(...conditions))
      .orderBy(asc(students.admissionNumber))
      .limit(limit);

    return apiSuccess({ students: rows, limit });
  } catch (error) {
    return handleApiError(error);
  }
}

interface CreateStudentBody {
  admissionNumber?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  branchId?: unknown;
  className?: unknown;
  section?: unknown;
  guardianName?: unknown;
  guardianPhone?: unknown;
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRole(request, [
      'school_admin',
      'principal',
      'vice_principal',
      'coordinator',
    ]);

    const body = await readJsonBody<CreateStudentBody>(request);
    if (body === null) {
      return apiFailure('invalid_body', 'Expected a JSON body.', 400);
    }

    const admissionNumber =
      typeof body.admissionNumber === 'string' ? body.admissionNumber.trim() : '';
    const firstName = typeof body.firstName === 'string' ? body.firstName.trim() : '';
    const lastName = typeof body.lastName === 'string' ? body.lastName.trim() : '';

    if (admissionNumber === '' || firstName === '' || lastName === '') {
      return apiFailure(
        'invalid_body',
        'admissionNumber, firstName and lastName are required.',
        400,
      );
    }

    const branchId = typeof body.branchId === 'string' ? body.branchId : null;

    if (branchId !== null) {
      // A branch-scoped user may only enrol into their own branch.
      assertBranchAccess(auth, branchId);

      // And the branch must belong to this school — a UUID from another tenant
      // must not slip through the foreign key.
      const owned = await db
        .select({ id: branches.id })
        .from(branches)
        .where(and(eq(branches.id, branchId), eq(branches.locationId, auth.locationId)))
        .limit(1);

      if (owned[0] === undefined) {
        return apiFailure('invalid_branch', 'That branch does not exist.', 400);
      }
    }

    const inserted = await db
      .insert(students)
      .values({
        locationId: auth.locationId,
        branchId,
        admissionNumber,
        firstName,
        lastName,
        className: typeof body.className === 'string' ? body.className : null,
        section: typeof body.section === 'string' ? body.section : null,
        guardianName: typeof body.guardianName === 'string' ? body.guardianName : null,
        guardianPhone:
          typeof body.guardianPhone === 'string' ? body.guardianPhone : null,
      })
      .onConflictDoNothing()
      .returning({
        id: students.id,
        admissionNumber: students.admissionNumber,
        firstName: students.firstName,
        lastName: students.lastName,
        status: students.status,
      });

    const student = inserted[0];
    if (student === undefined) {
      return apiFailure(
        'already_exists',
        'A student with that admission number already exists.',
        409,
      );
    }

    return apiSuccess({ student }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
