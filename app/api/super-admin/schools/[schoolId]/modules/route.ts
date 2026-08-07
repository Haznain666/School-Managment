import { eq, sql } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { schoolModules } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import {
  isSchoolFlagKey,
  toChannelFlags,
  toModuleFlags,
  type SchoolFlagKey,
} from '@/lib/platform-modules';
import { resolveLocationId } from '@/lib/schools';
import { requireSuperAdmin } from '@/lib/super-admin-guard';
import { isUuid } from '@/lib/validation';

/**
 * /api/super-admin/schools/[schoolId]/modules
 *
 * GET   current on/off state for every module and channel
 * PATCH bulk update — an array of { module_key, is_enabled }
 *
 * Rows are upserted rather than assumed to exist, so a school provisioned
 * before a module was added to the catalogue still toggles cleanly.
 *
 * ── Channels ride the same route ─────────────────────────────────────────
 * `whatsapp` is a delivery channel rather than a product module, and renders
 * in its own section of the school page — but it is stored in the same table
 * and written through the same upsert, so it is accepted here too. The
 * response separates them (`modules` and `channels`) because the two UIs read
 * different halves; `rows` still carries everything.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ schoolId: string }> };

/**
 * Refers to the value the INSERT tried to write, for the ON CONFLICT branch.
 * Postgres exposes it as the pseudo-table `excluded`.
 */
function sqlExcluded(column: string) {
  return sql.raw(`excluded.${column}`);
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    await requireSuperAdmin();

    const { schoolId } = await context.params;
    if (!isUuid(schoolId)) {
      return apiFailure('not_found', 'School not found.', 404);
    }

    const locationId = await resolveLocationId(schoolId);
    if (locationId === null) {
      return apiFailure('not_found', 'School not found.', 404);
    }

    const rows = await db
      .select({
        moduleKey: schoolModules.moduleKey,
        isEnabled: schoolModules.isEnabled,
        enabledAt: schoolModules.enabledAt,
        enabledBy: schoolModules.enabledBy,
      })
      .from(schoolModules)
      .where(eq(schoolModules.locationId, locationId));

    return apiSuccess({
      modules: toModuleFlags(rows),
      channels: toChannelFlags(rows),
      rows,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

interface ModuleUpdate {
  module_key?: unknown;
  is_enabled?: unknown;
}

interface UpdateModulesBody {
  modules?: unknown;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireSuperAdmin();

    const { schoolId } = await context.params;
    if (!isUuid(schoolId)) {
      return apiFailure('not_found', 'School not found.', 404);
    }

    const locationId = await resolveLocationId(schoolId);
    if (locationId === null) {
      return apiFailure('not_found', 'School not found.', 404);
    }

    const body = await readJsonBody<UpdateModulesBody>(request);
    if (body === null || !Array.isArray(body.modules)) {
      return apiFailure(
        'invalid_body',
        'Expected { modules: [{ module_key, is_enabled }] }.',
        400,
      );
    }

    // Validate the whole batch before writing any of it — a partial apply
    // would leave the toggle grid disagreeing with the database.
    const updates: Array<{ key: SchoolFlagKey; enabled: boolean }> = [];

    for (const entry of body.modules as ModuleUpdate[]) {
      if (!isSchoolFlagKey(entry.module_key)) {
        return apiFailure('invalid_body', `Unknown module "${String(entry.module_key)}".`, 400);
      }
      if (typeof entry.is_enabled !== 'boolean') {
        return apiFailure('invalid_body', 'is_enabled must be a boolean.', 400);
      }
      updates.push({ key: entry.module_key, enabled: entry.is_enabled });
    }

    if (updates.length === 0) {
      return apiSuccess({ updated: 0 });
    }

    const now = new Date();

    await db
      .insert(schoolModules)
      .values(
        updates.map((update) => ({
          locationId,
          moduleKey: update.key,
          isEnabled: update.enabled,
          enabledAt: update.enabled ? now : null,
          enabledBy: update.enabled ? session.email : null,
        })),
      )
      .onConflictDoUpdate({
        target: [schoolModules.locationId, schoolModules.moduleKey],
        set: {
          isEnabled: sqlExcluded('is_enabled'),
          enabledAt: sqlExcluded('enabled_at'),
          enabledBy: sqlExcluded('enabled_by'),
        },
      });

    const rows = await db
      .select({
        moduleKey: schoolModules.moduleKey,
        isEnabled: schoolModules.isEnabled,
      })
      .from(schoolModules)
      .where(eq(schoolModules.locationId, locationId));

    return apiSuccess({
      updated: updates.length,
      modules: toModuleFlags(rows),
      channels: toChannelFlags(rows),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
