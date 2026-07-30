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
