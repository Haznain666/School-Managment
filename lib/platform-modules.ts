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
 * Delivery channels a school can be switched on or off.
 *
 * ── Why these are not modules ────────────────────────────────────────────
 * A module is a slice of the product — Admissions, Fees, Library. A channel is
 * how a message leaves the building. Putting "WhatsApp" in the list above
 * would have been one line of work and would have rendered it as a toggle
 * between "Hostel Management" and "Transport", which is not what it is.
 *
 * They share the `school_modules` table because the storage question — one
 * row per school per flag, absent means off, with an audit breadcrumb — has
 * the same answer for both, and a second table would have been a second thing
 * to keep in step. The CHECK constraint on that table accepts the union of
 * both key lists; see `db/migrations/0012_stage4_whatsapp_channel.sql`.
 *
 * ── WhatsApp specifically ────────────────────────────────────────────────
 * It is a paid add-on. A school with it off is not broken — email carries
 * everything, and the internal chat system (`ROADMAP.md` §5) is intended to
 * replace it outright. Until chat ships, "off" genuinely means some parents
 * are only reachable by email, which is why `lib/ghl-fees.ts` counts and
 * reports the ones it could not reach rather than failing quietly.
 */
export const PLATFORM_CHANNELS = [
  {
    key: 'whatsapp',
    label: 'WhatsApp',
    description:
      'Send invitations, fee notices and admission updates over WhatsApp, ' +
      'through this school’s GoHighLevel sub-account. A paid add-on. ' +
      'With it off, everything goes by email instead.',
  },
] as const;

export type PlatformChannel = (typeof PLATFORM_CHANNELS)[number];
export type PlatformChannelKey = PlatformChannel['key'];

export const PLATFORM_CHANNEL_KEYS: readonly PlatformChannelKey[] =
  PLATFORM_CHANNELS.map((channel) => channel.key);

/**
 * Everything `school_modules.module_key` may hold. The CHECK constraint in the
 * database is generated from this, so a key missing here cannot be stored.
 */
export const SCHOOL_FLAG_KEYS: readonly string[] = [
  ...PLATFORM_MODULE_KEYS,
  ...PLATFORM_CHANNEL_KEYS,
];

export function isPlatformChannelKey(value: unknown): value is PlatformChannelKey {
  return (
    typeof value === 'string' &&
    (PLATFORM_CHANNEL_KEYS as readonly string[]).includes(value)
  );
}

export type SchoolFlagKey = PlatformModuleKey | PlatformChannelKey;

/** Anything the toggle route may be asked to write. */
export function isSchoolFlagKey(value: unknown): value is SchoolFlagKey {
  return isPlatformModuleKey(value) || isPlatformChannelKey(value);
}

/** Per-school on/off state for every channel. */
export type SchoolChannelFlags = Record<PlatformChannelKey, boolean>;

export function emptyChannelFlags(): SchoolChannelFlags {
  const flags = {} as SchoolChannelFlags;
  for (const key of PLATFORM_CHANNEL_KEYS) {
    flags[key] = false;
  }
  return flags;
}

export function toChannelFlags(
  rows: readonly { moduleKey: string; isEnabled: boolean }[],
): SchoolChannelFlags {
  const flags = emptyChannelFlags();
  for (const row of rows) {
    if (isPlatformChannelKey(row.moduleKey)) {
      flags[row.moduleKey] = row.isEnabled;
    }
  }
  return flags;
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
