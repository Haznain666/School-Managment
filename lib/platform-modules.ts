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
      'The school’s own GoHighLevel sub-account. Used for contact sync and, ' +
      'when the WhatsApp channel is on, for delivering messages. Optional — ' +
      'a school works fully without one.',
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
 * What a bulk apply should do to one flag.
 *
 * `unchanged` is the default and is the reason this is three states rather
 * than a checkbox: a two-state control cannot distinguish "switch this off"
 * from "I did not touch this", and a bulk tool that reads the second as the
 * first switches off every module the selected schools had on.
 */
export type BulkFlagChoice = 'unchanged' | 'on' | 'off';

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
