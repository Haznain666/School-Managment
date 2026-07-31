import 'server-only';

import { and, asc, count, eq, ilike, or, type SQL } from 'drizzle-orm';

import {
  branches,
  schoolModules,
  schoolUsers,
  studentEnrollments,
  type SchoolUser,
} from '@/db/schema';
import { toModuleFlags, type SchoolModuleFlags } from '@/lib/platform-modules';
import type { UserRole } from '@/types/school-auth';

import { getActiveAcademicYear } from './admissions-queries';
import { db } from './drizzle';

/**
 * Tenant-scoped reads shared by the portal layouts, pages and API routes.
 *
 * Every function here takes `locationId` as its first argument and filters on
 * it. That value must always originate from verified session claims — passing
 * one from a request body would defeat the isolation these queries provide.
 */

export interface SchoolUserRow {
  id: string;
  firebaseUid: string | null;
  name: string;
  email: string | null;
  phone: string;
  role: string;
  branchId: string | null;
  branchName: string | null;
  isActive: boolean;
  joinedAt: Date | null;
  createdAt: Date;
}

const USER_COLUMNS = {
  id: schoolUsers.id,
  firebaseUid: schoolUsers.firebaseUid,
  name: schoolUsers.name,
  email: schoolUsers.email,
  phone: schoolUsers.phone,
  role: schoolUsers.role,
  branchId: schoolUsers.branchId,
  branchName: branches.name,
  isActive: schoolUsers.isActive,
  joinedAt: schoolUsers.joinedAt,
  createdAt: schoolUsers.createdAt,
} as const;

export interface ListUsersFilters {
  role?: string | undefined;
  branchId?: string | undefined;
  isActive?: boolean | undefined;
  search?: string | undefined;
  page?: number | undefined;
  limit?: number | undefined;
}

export async function listSchoolUsers(
  locationId: string,
  filters: ListUsersFilters,
): Promise<{ users: SchoolUserRow[]; total: number; page: number; limit: number }> {
  const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);
  const page = Math.max(filters.page ?? 1, 1);

  const conditions: SQL[] = [eq(schoolUsers.locationId, locationId)];

  if (filters.role !== undefined && filters.role !== '') {
    conditions.push(eq(schoolUsers.role, filters.role));
  }
  if (filters.branchId !== undefined && filters.branchId !== '') {
    conditions.push(eq(schoolUsers.branchId, filters.branchId));
  }
  if (filters.isActive !== undefined) {
    conditions.push(eq(schoolUsers.isActive, filters.isActive));
  }
  if (filters.search !== undefined && filters.search.trim() !== '') {
    const pattern = `%${filters.search.trim()}%`;
    const matches = or(ilike(schoolUsers.name, pattern), ilike(schoolUsers.phone, pattern));
    if (matches !== undefined) conditions.push(matches);
  }

  const where = and(...conditions);

  const [rows, totals] = await Promise.all([
    db
      .select(USER_COLUMNS)
      .from(schoolUsers)
      .leftJoin(branches, eq(branches.id, schoolUsers.branchId))
      .where(where)
      .orderBy(asc(schoolUsers.name))
      .limit(limit)
      .offset((page - 1) * limit),
    db.select({ value: count() }).from(schoolUsers).where(where),
  ]);

  return { users: rows, total: totals[0]?.value ?? 0, page, limit };
}

export async function getSchoolUserById(
  locationId: string,
  userId: string,
): Promise<SchoolUserRow | null> {
  const rows = await db
    .select(USER_COLUMNS)
    .from(schoolUsers)
    .leftJoin(branches, eq(branches.id, schoolUsers.branchId))
    .where(and(eq(schoolUsers.locationId, locationId), eq(schoolUsers.id, userId)))
    .limit(1);

  return rows[0] ?? null;
}

export async function getSchoolUserByUid(
  locationId: string,
  firebaseUid: string,
): Promise<SchoolUserRow | null> {
  const rows = await db
    .select(USER_COLUMNS)
    .from(schoolUsers)
    .leftJoin(branches, eq(branches.id, schoolUsers.branchId))
    .where(
      and(eq(schoolUsers.locationId, locationId), eq(schoolUsers.firebaseUid, firebaseUid)),
    )
    .limit(1);

  return rows[0] ?? null;
}

/** Enabled-module flags for one school. */
export async function getModuleFlags(locationId: string): Promise<SchoolModuleFlags> {
  const rows = await db
    .select({ moduleKey: schoolModules.moduleKey, isEnabled: schoolModules.isEnabled })
    .from(schoolModules)
    .where(eq(schoolModules.locationId, locationId));

  return toModuleFlags(rows);
}

export interface BranchOption {
  id: string;
  name: string;
  code: string;
  city: string;
}

export async function listBranchOptions(locationId: string): Promise<BranchOption[]> {
  return db
    .select({
      id: branches.id,
      name: branches.name,
      code: branches.code,
      city: branches.city,
    })
    .from(branches)
    .where(and(eq(branches.locationId, locationId), eq(branches.isActive, true)))
    .orderBy(asc(branches.name));
}

export interface DashboardCounts {
  students: number;
  staff: number;
  branches: number;
  modules: number;
  /** Null when no academic year is active, so the UI can say why. */
  activeYearName: string | null;
}

const STAFF_ROLES: readonly UserRole[] = [
  'teacher',
  'accountant',
  'hr_manager',
  'branch_admin',
];

/**
 * Headline counts for the admin dashboard, all scoped to one school.
 *
 * Students are counted from `student_enrollments` in the active academic year
 * rather than from the directory: a graduated or withdrawn student keeps their
 * `school_users` row, so counting those would only ever go up.
 */
export async function getDashboardCounts(locationId: string): Promise<DashboardCounts> {
  const activeYear = await getActiveAcademicYear(locationId);

  const [studentRows, staffRows, branchRows, moduleRows] = await Promise.all([
    activeYear === null
      ? Promise.resolve([{ value: 0 }])
      : db
          .select({ value: count() })
          .from(studentEnrollments)
          .where(
            and(
              eq(studentEnrollments.locationId, locationId),
              eq(studentEnrollments.academicYearId, activeYear.id),
              eq(studentEnrollments.status, 'active'),
            ),
          ),
    db
      .select({ role: schoolUsers.role })
      .from(schoolUsers)
      .where(
        and(eq(schoolUsers.locationId, locationId), eq(schoolUsers.isActive, true)),
      ),
    db
      .select({ value: count() })
      .from(branches)
      .where(and(eq(branches.locationId, locationId), eq(branches.isActive, true))),
    db
      .select({ value: count() })
      .from(schoolModules)
      .where(
        and(eq(schoolModules.locationId, locationId), eq(schoolModules.isEnabled, true)),
      ),
  ]);

  // Counted in memory rather than with an IN clause so the staff role list
  // stays a single definition shared with the rest of the app.
  const staff = staffRows.filter((row) =>
    (STAFF_ROLES as readonly string[]).includes(row.role),
  ).length;

  return {
    students: studentRows[0]?.value ?? 0,
    staff,
    branches: branchRows[0]?.value ?? 0,
    modules: moduleRows[0]?.value ?? 0,
    activeYearName: activeYear?.name ?? null,
  };
}

export type { SchoolUser };
