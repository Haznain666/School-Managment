import { and, eq } from 'drizzle-orm';

import { rolePermissions, schoolUsers } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { batch, db, type Tx } from '@/lib/drizzle';
import {
  freshPermissionMatrix,
  loadOverrides,
  permissionMatrix,
} from '@/lib/permission-queries';
import {
  DEFAULT_ROLE_PERMISSIONS,
  UNREVOKABLE,
  isPermission,
  type Permission,
} from '@/lib/permissions';
import { isUserRole, type UserRole } from '@/types/school-auth';

/**
 * /api/school/permissions
 *
 * GET   the school's effective matrix, plus the overrides behind it
 * PATCH change cells
 *
 * ── Why the payload is a list of changes, not the whole matrix ────────────
 * Sending the whole matrix would mean an administrator who opened the screen
 * an hour ago silently reverts whatever a colleague changed in between. A list
 * of cells only touches what was actually toggled, so two people tidying
 * different sections do not overwrite each other.
 *
 * ── Why a cell matching the default is deleted rather than stored ─────────
 * `role_permissions` holds departures from the default. A row that agrees with
 * the default is not a departure — and storing it would freeze that cell at
 * today's value, so a later sprint that widened a default would skip this
 * school without anyone noticing. Toggling a permission off and back on
 * therefore leaves no trace, which is the correct outcome.
 *
 * ── The one cell nobody may change ───────────────────────────────────────
 * `school_admin` keeps `permissions.manage`. Without that rule the screen
 * offers a school a button that locks it out of its own configuration, with no
 * way back short of a support ticket against the database.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (_request, auth) => {
    try {
      const [matrix, overrides] = await Promise.all([
        permissionMatrix(auth.locationId),
        loadOverrides(auth.locationId),
      ]);

      return apiSuccess({
        matrix,
        overrides,
        // The defaults travel with the response so the screen can mark which
        // cells a school has actually changed, and offer to reset them.
        defaults: DEFAULT_ROLE_PERMISSIONS,
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'permissions.manage' },
);

interface ChangeInput {
  role?: unknown;
  permission?: unknown;
  isGranted?: unknown;
}

interface UpdatePermissionsBody {
  changes?: unknown;
}

export const PATCH = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<UpdatePermissionsBody>(request);
      if (body === null || !Array.isArray(body.changes)) {
        return apiFailure('invalid_body', 'Expected a "changes" array.', 400);
      }

      if (body.changes.length === 0) {
        return apiFailure('invalid_body', 'Nothing to change.', 400);
      }

      if (body.changes.length > 500) {
        return apiFailure('invalid_body', 'Too many changes in one request.', 400);
      }

      const parsed: Array<{
        role: UserRole;
        permission: Permission;
        isGranted: boolean;
      }> = [];

      for (const raw of body.changes as ChangeInput[]) {
        if (!isUserRole(raw.role)) {
          return apiFailure('invalid_body', 'One of the roles is not valid.', 400);
        }

        if (!isPermission(raw.permission)) {
          return apiFailure('invalid_body', 'One of the permissions is not valid.', 400);
        }

        if (typeof raw.isGranted !== 'boolean') {
          return apiFailure(
            'invalid_body',
            'Every change must say whether the permission is granted.',
            400,
          );
        }

        if (
          raw.role === UNREVOKABLE.role &&
          raw.permission === UNREVOKABLE.permission &&
          !raw.isGranted
        ) {
          return apiFailure(
            'forbidden',
            'A School Administrator must keep the ability to manage permissions — otherwise nobody could grant it back.',
            409,
          );
        }

        // Students and parents reach portals that ask no permission, so a row
        // against them would be a setting with no effect.
        if (raw.role === 'student' || raw.role === 'parent') {
          return apiFailure(
            'invalid_body',
            'Student and parent access is not permission-managed.',
            400,
          );
        }

        parsed.push({
          role: raw.role,
          permission: raw.permission,
          isGranted: raw.isGranted,
        });
      }

      // Who made the change. A revoked permission gets asked about later.
      const actors = await db
        .select({ id: schoolUsers.id })
        .from(schoolUsers)
        .where(
          and(
            eq(schoolUsers.locationId, auth.locationId),
            eq(schoolUsers.firebaseUid, auth.uid),
          ),
        )
        .limit(1);

      const updatedBy = actors[0]?.id ?? null;
      const now = new Date();

      // Deferred until `batch()` opens the transaction: a Drizzle builder is
      // bound to the session that created it, so these must be built on `tx`.
      const statements = parsed.map((change) => (tx: Tx) => {
        const isDefault =
          DEFAULT_ROLE_PERMISSIONS[change.role].includes(change.permission) ===
          change.isGranted;

        if (isDefault) {
          return tx
            .delete(rolePermissions)
            .where(
              and(
                eq(rolePermissions.locationId, auth.locationId),
                eq(rolePermissions.role, change.role),
                eq(rolePermissions.permission, change.permission),
              ),
            );
        }

        return tx
          .insert(rolePermissions)
          .values({
            // Tenant comes from the verified session, never from the body.
            locationId: auth.locationId,
            role: change.role,
            permission: change.permission,
            isGranted: change.isGranted,
            updatedBy,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [
              rolePermissions.locationId,
              rolePermissions.role,
              rolePermissions.permission,
            ],
            set: { isGranted: change.isGranted, updatedBy, updatedAt: now },
          });
      });

      // One transaction, so a half-applied matrix cannot be observed by a
      // request that lands mid-save.
      await batch(db, (tx) => statements.map((statement) => statement(tx)));

      // Read fresh, not through the request cache — `withSchoolAuth` already
      // populated it above, and it predates the batch we just committed.
      return apiSuccess({
        matrix: await freshPermissionMatrix(auth.locationId),
        changed: parsed.length,
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'permissions.manage' },
);
