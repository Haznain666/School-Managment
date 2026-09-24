import {
  emptySuperAdminPermissions,
  SUPER_ADMIN_ACTIONS,
  SUPER_ADMIN_AREAS,
  type SuperAdminPermissions,
} from './super-admin-permissions';

/**
 * Reads the permission grid off a request body — strictly.
 *
 * Every area and every action must be present and boolean. A grid that is
 * missing a cell is refused rather than filled with false, because "the owner
 * ticked nothing" and "the browser sent half a grid" must not look the same
 * once saved.
 */
export function readPermissionGrid(raw: unknown): SuperAdminPermissions | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const grid = emptySuperAdminPermissions();

  for (const area of SUPER_ADMIN_AREAS) {
    const entry = record[area];
    if (entry === null || typeof entry !== 'object') return null;
    const actions = entry as Record<string, unknown>;
    for (const action of SUPER_ADMIN_ACTIONS) {
      if (typeof actions[action] !== 'boolean') return null;
      grid[area][action] = actions[action] === true;
    }
    // Create, edit or delete without view is nothing; see
    // `normaliseSuperAdminPermissions`, which reads it back the same way.
    if (grid[area].c || grid[area].u || grid[area].d) grid[area].r = true;
  }

  return grid;
}
