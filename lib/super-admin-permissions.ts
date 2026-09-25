/**
 * What a super admin other than the owner may do — Sprint 35, §9.
 *
 * Pure and dependency-free, because three places read it: the API guard, the
 * pages that decide what to render, and the permission grid in the browser.
 *
 * ── Areas, not screens ───────────────────────────────────────────────────
 * Six areas, each with Create / View / Edit / Delete (Q4). An area is a *kind
 * of thing* the platform holds, not a page: `billing` covers invoices, rates,
 * receipts and the platform's bank accounts, because a person trusted with one
 * of those and not the others is a distinction nobody has asked for and a grid
 * four times the size.
 *
 * ── The owner holds everything, implicitly ───────────────────────────────
 * Not by a row of ticks that somebody could untick. `is_owner` short-circuits
 * every check, and the database refuses to let that flag move (`0052`'s
 * trigger). A grid that could lock the owner out of the grid is a grid with one
 * irreversible click in it.
 */

export const SUPER_ADMIN_AREAS = [
  'schools',
  'modules',
  'billing',
  'feedback',
  'catalogue',
  'super_admins',
] as const;
export type SuperAdminArea = (typeof SUPER_ADMIN_AREAS)[number];

export const SUPER_ADMIN_ACTIONS = ['c', 'r', 'u', 'd'] as const;
export type SuperAdminAction = (typeof SUPER_ADMIN_ACTIONS)[number];

export const SUPER_ADMIN_AREA_LABELS: Record<SuperAdminArea, string> = {
  schools: 'Schools',
  modules: 'Modules',
  billing: 'Billing',
  feedback: 'Feedback',
  catalogue: 'Features & Roadmap',
  super_admins: 'Super admins',
};

export const SUPER_ADMIN_AREA_DESCRIPTIONS: Record<SuperAdminArea, string> = {
  schools: 'Tenants, campuses, branding, integrations, users, Login as Admin.',
  modules: 'Module switches, per school and across schools.',
  billing: 'Invoices, rates, receipts, access blocks and the platform bank accounts.',
  feedback: 'The feedback queue from every school.',
  catalogue: 'The Features and Roadmap reference tabs.',
  super_admins: 'Other super admins — never the owner, and never their permissions.',
};

export const SUPER_ADMIN_ACTION_LABELS: Record<SuperAdminAction, string> = {
  c: 'Create',
  r: 'View',
  u: 'Edit',
  d: 'Delete',
};

export type SuperAdminPermissions = Record<SuperAdminArea, Record<SuperAdminAction, boolean>>;

export function emptySuperAdminPermissions(): SuperAdminPermissions {
  const result = {} as SuperAdminPermissions;
  for (const area of SUPER_ADMIN_AREAS) {
    result[area] = { c: false, r: false, u: false, d: false };
  }
  return result;
}

export function fullSuperAdminPermissions(): SuperAdminPermissions {
  const result = {} as SuperAdminPermissions;
  for (const area of SUPER_ADMIN_AREAS) {
    result[area] = { c: true, r: true, u: true, d: true };
  }
  return result;
}

/**
 * Reads whatever is in the `permissions` jsonb into the full shape.
 *
 * Anything unrecognised is dropped and anything missing is false, so a row
 * written by an older build — or by hand — can never grant more than it
 * spells out. One rule on top: holding C, U or D on an area implies R, because
 * a person who may edit a thing they cannot open has been given nothing.
 */
export function normaliseSuperAdminPermissions(raw: unknown): SuperAdminPermissions {
  const result = emptySuperAdminPermissions();
  if (raw === null || typeof raw !== 'object') return result;

  const record = raw as Record<string, unknown>;
  for (const area of SUPER_ADMIN_AREAS) {
    const entry = record[area];
    if (entry === null || typeof entry !== 'object') continue;
    const actions = entry as Record<string, unknown>;
    for (const action of SUPER_ADMIN_ACTIONS) {
      result[area][action] = actions[action] === true;
    }
    if (result[area].c || result[area].u || result[area].d) result[area].r = true;
  }

  return result;
}

export interface SuperAdminCapability {
  isOwner: boolean;
  permissions: SuperAdminPermissions;
}

export function superAdminCan(
  actor: SuperAdminCapability,
  area: SuperAdminArea,
  action: SuperAdminAction,
): boolean {
  if (actor.isOwner) return true;
  return actor.permissions[area][action];
}

/**
 * May `actor` manage `target` — edit, reset the password of, or delete them?
 *
 * The owner may manage anyone. Anybody else only an admin whose every right
 * they hold themselves: otherwise resetting a broader admin's password and
 * signing in as them would be a way to acquire rights the owner never gave.
 */
export function canManageSuperAdmin(
  actor: SuperAdminCapability,
  target: SuperAdminCapability,
): boolean {
  if (actor.isOwner) return true;
  if (target.isOwner) return false;
  return SUPER_ADMIN_AREAS.every((area) =>
    SUPER_ADMIN_ACTIONS.every(
      (action) => !target.permissions[area][action] || actor.permissions[area][action],
    ),
  );
}

export function isSuperAdminArea(value: unknown): value is SuperAdminArea {
  return typeof value === 'string' && (SUPER_ADMIN_AREAS as readonly string[]).includes(value);
}

/** The owner's address. Seeded on the owner's first sign-in after `0052`; see §9. */
export const PLATFORM_OWNER_EMAIL = 'haznain666@gmail.com';
