import 'server-only';

import { cache } from 'react';
import { and, eq } from 'drizzle-orm';

import { rolePermissions } from '@/db/schema';
import { isUserRole, type UserRole } from '@/types/school-auth';

import { db } from './drizzle';
import {
  isPermission,
  resolveMatrix,
  resolvePermission,
  resolveRolePermissions,
  type Permission,
  type PermissionOverride,
} from './permissions';

/**
 * The database half of the permission model.
 *
 * `lib/permissions.ts` decides what a set of overrides *means*; this decides
 * where they come from. The split exists so the browser can render the same
 * matrix the server enforces without pulling Drizzle into the client bundle.
 *
 * ── On the cache ─────────────────────────────────────────────────────────
 * `loadOverrides` is wrapped in React's `cache`, so a request that checks three
 * permissions — a layout, then two routes it renders — reads the table once.
 * The cache is per-request and keyed on `locationId`, so it can neither leak a
 * school's grants into another request nor serve a stale answer after an
 * administrator saves the matrix.
 *
 * `locationId` must always come from verified session claims. Everything here
 * takes it first, and nothing here may be called with a value out of a request
 * body — the same contract every other query module in this codebase has.
 */

/**
 * Reads a school's overrides straight from the table, bypassing the cache.
 *
 * Use this after a write in the same request. `loadOverrides` memoises for the
 * request, so a save followed by a cached read would answer with the matrix as
 * it was before the save — and the screen would show the administrator their
 * change being ignored.
 */
export async function readOverrides(
  locationId: string,
): Promise<PermissionOverride[]> {
  const rows = await db
    .select({
      role: rolePermissions.role,
      permission: rolePermissions.permission,
      isGranted: rolePermissions.isGranted,
    })
    .from(rolePermissions)
    .where(eq(rolePermissions.locationId, locationId));

  // Rows written before a role or permission was retired are dropped rather
  // than trusted. The CHECK constraints make that near-impossible today, but a
  // stale grant silently widening access is not a failure mode worth leaving
  // open for the sake of three lines.
  return rows.flatMap((row) =>
    isUserRole(row.role) && isPermission(row.permission)
      ? [{ role: row.role, permission: row.permission, isGranted: row.isGranted }]
      : [],
  );
}

export const loadOverrides = cache(
  async (locationId: string): Promise<PermissionOverride[]> => readOverrides(locationId),
);

/** Whether a role holds a permission at this school. */
export async function hasPermission(
  locationId: string,
  role: UserRole,
  permission: Permission,
): Promise<boolean> {
  return resolvePermission(role, permission, await loadOverrides(locationId));
}

/** Every permission a role effectively holds at this school. */
export async function permissionsForRole(
  locationId: string,
  role: UserRole,
): Promise<Permission[]> {
  return resolveRolePermissions(role, await loadOverrides(locationId));
}

/** The whole matrix, for the permissions screen. */
export async function permissionMatrix(
  locationId: string,
): Promise<Record<UserRole, Permission[]>> {
  return resolveMatrix(await loadOverrides(locationId));
}

/** The whole matrix, read fresh. For the response to a save — see `readOverrides`. */
export async function freshPermissionMatrix(
  locationId: string,
): Promise<Record<UserRole, Permission[]>> {
  return resolveMatrix(await readOverrides(locationId));
}

/**
 * Removes a school's override for one cell, returning it to the default.
 *
 * Saving the matrix deletes rather than writes whenever the requested value
 * already matches the default, so a school that toggles a permission off and
 * back on ends up with no row at all — and therefore keeps following the
 * default if a later sprint changes it.
 */
export async function clearOverride(
  locationId: string,
  role: UserRole,
  permission: Permission,
): Promise<void> {
  await db
    .delete(rolePermissions)
    .where(
      and(
        eq(rolePermissions.locationId, locationId),
        eq(rolePermissions.role, role),
        eq(rolePermissions.permission, permission),
      ),
    );
}
