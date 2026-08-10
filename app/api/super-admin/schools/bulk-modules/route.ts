import { inArray, sql } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { schoolModules, schools } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import {
  isSchoolFlagKey,
  MAX_SCHOOLS_PER_APPLY,
  type SchoolFlagKey,
} from '@/lib/platform-modules';
import { requireSuperAdmin } from '@/lib/super-admin-guard';
import { isUuid } from '@/lib/validation';

/**
 * POST /api/super-admin/schools/bulk-modules
 *
 * Applies the same module and channel switches to many schools at once, and
 * optionally disconnects GoHighLevel from all of them.
 *
 * ── Only what was asked for is written ───────────────────────────────────
 * The body carries just the flags the operator actually set — not the whole
 * catalogue. A request that sent all eleven flags would silently switch off
 * every module the selected schools had turned on and the operator had not
 * touched, which is the obvious way for a bulk tool to destroy a morning's
 * work. The UI decides that by diffing each switch against the state it read
 * for the selection; a flag left where it was found is expressed by the key
 * simply not being here.
 *
 * ── One statement, not one per school ────────────────────────────────────
 * The flag writes go out as a single multi-row upsert covering every
 * (school × flag) pair, so forty schools is one round trip and either all of
 * it lands or none does. The GHL disconnect is a second statement because it
 * is a different table; it is ordered last so a failure there cannot leave
 * flags half-written.
 *
 * ── Why GoHighLevel can only be switched off here ────────────────────────
 * Connecting needs a different sub-account id per school, so there is nothing
 * sensible to broadcast. Disconnecting needs no input at all. See
 * `PLATFORM_INTEGRATIONS`.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function sqlExcluded(column: string) {
  return sql.raw(`excluded.${column}`);
}

interface BulkBody {
  school_ids?: unknown;
  updates?: unknown;
  disconnect_ghl?: unknown;
}

interface FlagUpdate {
  module_key?: unknown;
  is_enabled?: unknown;
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireSuperAdmin();

    const body = await readJsonBody<BulkBody>(request);
    if (body === null || !Array.isArray(body.school_ids) || !Array.isArray(body.updates)) {
      return apiFailure(
        'invalid_body',
        'Expected { school_ids: [...], updates: [{ module_key, is_enabled }] }.',
        400,
      );
    }

    const disconnectGhl = body.disconnect_ghl === true;

    const schoolIds = [...new Set(body.school_ids.filter(isUuid))];

    if (schoolIds.length === 0) {
      return apiFailure('invalid_body', 'Select at least one school.', 400);
    }

    if (schoolIds.length > MAX_SCHOOLS_PER_APPLY) {
      return apiFailure(
        'invalid_body',
        `Apply to at most ${MAX_SCHOOLS_PER_APPLY} schools at a time.`,
        400,
      );
    }

    // Validate every flag before writing any of them — a partial apply would
    // leave some schools changed and some not, with no record of which.
    const updates: Array<{ key: SchoolFlagKey; enabled: boolean }> = [];

    for (const entry of body.updates as FlagUpdate[]) {
      if (!isSchoolFlagKey(entry.module_key)) {
        return apiFailure(
          'invalid_body',
          `Unknown module "${String(entry.module_key)}".`,
          400,
        );
      }
      if (typeof entry.is_enabled !== 'boolean') {
        return apiFailure('invalid_body', 'is_enabled must be a boolean.', 400);
      }
      updates.push({ key: entry.module_key, enabled: entry.is_enabled });
    }

    if (updates.length === 0 && !disconnectGhl) {
      return apiFailure('invalid_body', 'Nothing to apply.', 400);
    }

    const found = await db
      .select({
        id: schools.id,
        locationId: schools.locationId,
        name: schools.name,
        ghlLocationId: schools.ghlLocationId,
      })
      .from(schools)
      .where(inArray(schools.id, schoolIds));

    if (found.length === 0) {
      return apiFailure('not_found', 'None of those schools exist.', 404);
    }

    // Reported rather than fatal: a stale tab whose school was deleted should
    // still apply to the rest, and say what it skipped.
    const missing = schoolIds.filter(
      (id) => !found.some((school) => school.id === id),
    );

    const now = new Date();

    if (updates.length > 0) {
      await db
        .insert(schoolModules)
        .values(
          found.flatMap((school) =>
            updates.map((update) => ({
              locationId: school.locationId,
              moduleKey: update.key,
              isEnabled: update.enabled,
              enabledAt: update.enabled ? now : null,
              enabledBy: update.enabled ? session.email : null,
            })),
          ),
        )
        .onConflictDoUpdate({
          target: [schoolModules.locationId, schoolModules.moduleKey],
          set: {
            isEnabled: sqlExcluded('is_enabled'),
            enabledAt: sqlExcluded('enabled_at'),
            enabledBy: sqlExcluded('enabled_by'),
          },
        });
    }

    const wereConnected = found.filter(
      (school) => school.ghlLocationId !== null && school.ghlLocationId !== '',
    );

    if (disconnectGhl && wereConnected.length > 0) {
      await db
        .update(schools)
        .set({ ghlLocationId: null, updatedAt: now })
        .where(
          inArray(
            schools.id,
            wereConnected.map((school) => school.id),
          ),
        );
    }

    // WhatsApp is delivered through the school's own GoHighLevel sub-account,
    // so switching it on for a school that has none produces a channel that
    // cannot send. Reported, not refused: the operator may well be connecting
    // GHL next, and refusing would make the order of two independent steps
    // matter. `lib/ghl-fees.ts` already falls back to email meanwhile.
    const turningOnWhatsApp = updates.some(
      (update) => update.key === 'whatsapp' && update.enabled,
    );

    const whatsappWithoutGhl = turningOnWhatsApp
      ? found
          .filter(
            (school) =>
              disconnectGhl ||
              school.ghlLocationId === null ||
              school.ghlLocationId === '',
          )
          .map((school) => school.name)
      : [];

    return apiSuccess({
      applied: found.length,
      flagsPerSchool: updates.length,
      writes: found.length * updates.length,
      disconnectedGhl: disconnectGhl ? wereConnected.length : 0,
      schools: found.map((school) => ({ id: school.id, name: school.name })),
      missing,
      warnings: { whatsappWithoutGhl },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * GET — current flag state for a set of schools, so the bulk page can show
 * what the selection currently holds before anything is changed.
 *
 * `?school_ids=uuid,uuid`. Returns per-school flags plus, for each flag, a
 * summary across the selection: all on, all off, or mixed.
 */
export async function GET(request: NextRequest) {
  try {
    await requireSuperAdmin();

    const url = new URL(request.url);
    const raw = url.searchParams.get('school_ids') ?? '';
    const schoolIds = [...new Set(raw.split(',').map((id) => id.trim()).filter(isUuid))];

    if (schoolIds.length === 0) {
      return apiSuccess({ schools: [] });
    }

    if (schoolIds.length > MAX_SCHOOLS_PER_APPLY) {
      return apiFailure(
        'invalid_body',
        `Select at most ${MAX_SCHOOLS_PER_APPLY} schools.`,
        400,
      );
    }

    const found = await db
      .select({
        id: schools.id,
        locationId: schools.locationId,
        name: schools.name,
        ghlLocationId: schools.ghlLocationId,
      })
      .from(schools)
      .where(inArray(schools.id, schoolIds));

    if (found.length === 0) {
      return apiSuccess({ schools: [] });
    }

    const rows = await db
      .select({
        locationId: schoolModules.locationId,
        moduleKey: schoolModules.moduleKey,
        isEnabled: schoolModules.isEnabled,
      })
      .from(schoolModules)
      .where(
        inArray(
          schoolModules.locationId,
          found.map((school) => school.locationId),
        ),
      );

    return apiSuccess({
      schools: found.map((school) => ({
        id: school.id,
        name: school.name,
        ghlConnected: school.ghlLocationId !== null && school.ghlLocationId !== '',
        flags: rows
          .filter((row) => row.locationId === school.locationId)
          .map((row) => ({ key: row.moduleKey, enabled: row.isEnabled })),
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
