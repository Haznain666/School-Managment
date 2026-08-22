/**
 * The platform's module catalogue.
 *
 * A module is a slice of functionality a school can be switched on or off
 * independently. `phase` groups them by delivery wave and is what the Super
 * Admin toggle grid sections on.
 *
 * This file is the single source of truth: the `school_modules` CHECK
 * constraint, the toggle UI, and the portal navigation all derive from it.
 */

export const PLATFORM_MODULES = [
  { key: 'admissions', label: 'Admissions & Enrollment', phase: 1 },
  { key: 'fee_management', label: 'Fee Management', phase: 1 },
  { key: 'academics', label: 'Academics & Timetable', phase: 1 },
  { key: 'lms', label: 'LMS (Learning Management)', phase: 2 },
  { key: 'hr_payroll', label: 'HR & Payroll', phase: 2 },
  { key: 'accounts', label: 'Accounts & Finance', phase: 2 },
  { key: 'event_mgmt', label: 'Event Management', phase: 2 },
  { key: 'transport', label: 'Transport Management', phase: 3 },
  { key: 'library', label: 'Library Management', phase: 3 },
  { key: 'hostel', label: 'Hostel Management', phase: 3 },
] as const;

export type PlatformModule = (typeof PLATFORM_MODULES)[number];
export type PlatformModuleKey = PlatformModule['key'];
export type PlatformModulePhase = PlatformModule['phase'];

export const PLATFORM_MODULE_KEYS: readonly PlatformModuleKey[] =
  PLATFORM_MODULES.map((module) => module.key);

/**
 * Third-party accounts a school can be connected to.
 *
 * ── Why these are neither modules nor channels ───────────────────────────
 * A module and a channel are both booleans, and both live as a row in
 * `school_modules`. An integration is not a boolean: connecting GoHighLevel
 * means storing *which* sub-account, and `schools.ghl_location_id` is where
 * that goes. There is deliberately no `ghl` flag in `school_modules` — a flag
 * beside the id could disagree with it, and "connected" would then have two
 * answers. Connected means the column is set. That is the whole rule.
 *
 * ── What follows from that, and it is the awkward part ───────────────────
 * An integration cannot be switched *on* for many schools at once, because
 * each needs a different id (the column is `unique`, so it could not even be
 * fudged). It can be switched *off* for many at once, because clearing a
 * column needs no per-school input. The bulk page reflects exactly this
 * asymmetry rather than pretending the two directions are symmetrical.
 */
export const PLATFORM_INTEGRATIONS = [
  {
    key: 'gohighlevel',
    label: 'GoHighLevel',
    /** The per-school value that has to be supplied to connect it. */
    credentialLabel: 'GHL Location ID',
    description:
      'The school’s own GoHighLevel sub-account. Used for contact sync only — ' +
      'nothing on this platform sends messages through it. Optional: a school ' +
      'works fully without one.',
  },
] as const;

export type PlatformIntegration = (typeof PLATFORM_INTEGRATIONS)[number];
export type PlatformIntegrationKey = PlatformIntegration['key'];

/**
 * The most schools one bulk apply may touch.
 *
 * Not a database limit — a blast-radius limit. Beyond this the operator is
 * almost certainly selecting "everything" without having read what is
 * selected, and this is a tool that can switch Fee Management off for every
 * school on the platform in one click. Enforced in the route; the bulk page
 * reads the same constant so the two cannot disagree about the number.
 */
export const MAX_SCHOOLS_PER_APPLY = 100;

/**
 * Where one flag's switch stands on the bulk page.
 *
 * A switch is On or Off — nothing else, because that is what a switch is. The
 * safety a third "leave unchanged" state used to provide is now provided by
 * the baseline instead: the switch is *initialised from what the selected
 * schools actually hold*, and only the flags whose switch has been moved away
 * from that baseline are sent. A flag nobody touched still matches its
 * baseline, so it is still never written. See `BulkFlagBaseline` for the one
 * case a boolean cannot express.
 */
export type BulkFlagChoice = 'on' | 'off';

/**
 * What the selected schools currently hold for one flag.
 *
 * `mixed` is not a switch position — it is the honest answer when three
 * schools are selected and two have the module on. The switch is drawn with
 * neither side lit and the row's badge says "on at 2 of 3"; whichever side is
 * then pressed is a real change, because it normalises the selection either
 * way.
 */
export type BulkFlagBaseline = BulkFlagChoice | 'mixed';

/**
 * Everything `school_modules.module_key` may hold. The CHECK constraint in the
 * database is generated from this, so a key missing here cannot be stored.
 *
 * ── There used to be a second list ───────────────────────────────────────
 * `PLATFORM_CHANNELS` sat beside `PLATFORM_MODULES` and held exactly one
 * entry, `whatsapp`, sharing this table because "one row per school per flag"
 * was the right storage answer for both. WhatsApp was removed from the
 * platform on 2026-08-22 and that list went with it, along with the
 * channel-vs-module distinction it was the only member of. Email is not a
 * flag: it is how this product talks to people, and a school cannot switch it
 * off.
 *
 * `0028` removes the `whatsapp` rows and rewrites the CHECK constraint to
 * match. Anything that comes back — chat, push — is a module or it is nothing.
 */
export const SCHOOL_FLAG_KEYS: readonly string[] = [...PLATFORM_MODULE_KEYS];

export type SchoolFlagKey = PlatformModuleKey;

/** Anything the toggle route may be asked to write. */
export function isSchoolFlagKey(value: unknown): value is SchoolFlagKey {
  return isPlatformModuleKey(value);
}

/** Phases in display order. */
export const PLATFORM_MODULE_PHASES: readonly PlatformModulePhase[] = [1, 2, 3];

/** Per-school on/off state for every module. */
export type SchoolModuleFlags = Record<PlatformModuleKey, boolean>;

/** All modules off — the state of a freshly provisioned school. */
export function emptyModuleFlags(): SchoolModuleFlags {
  const flags = {} as SchoolModuleFlags;
  for (const key of PLATFORM_MODULE_KEYS) {
    flags[key] = false;
  }
  return flags;
}

export function isPlatformModuleKey(value: unknown): value is PlatformModuleKey {
  return (
    typeof value === 'string' &&
    (PLATFORM_MODULE_KEYS as readonly string[]).includes(value)
  );
}

export function modulesInPhase(phase: PlatformModulePhase): PlatformModule[] {
  return PLATFORM_MODULES.filter((module) => module.phase === phase);
}

export function moduleLabel(key: PlatformModuleKey): string {
  return PLATFORM_MODULES.find((module) => module.key === key)?.label ?? key;
}

/**
 * Turns `school_modules` rows into a complete flag record. Modules with no row
 * default to disabled.
 */
export function toModuleFlags(
  rows: ReadonlyArray<{ moduleKey: string; isEnabled: boolean }>,
): SchoolModuleFlags {
  const flags = emptyModuleFlags();
  for (const row of rows) {
    if (isPlatformModuleKey(row.moduleKey)) {
      flags[row.moduleKey] = row.isEnabled;
    }
  }
  return flags;
}
